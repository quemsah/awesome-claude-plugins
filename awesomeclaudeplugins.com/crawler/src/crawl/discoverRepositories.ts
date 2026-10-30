import type Database from 'better-sqlite3'
import { type GitHubReader, GitHubTemporaryError, type RepositorySearchPage } from '../github/client.js'
import {
  buildRepositorySearchQuery,
  type DateWindow,
  historicalWindows,
  type RepositorySearchQuery,
  repositorySearchQueries,
  repositorySearchQueryVersion,
  rollingPushedWindow,
  splitDateWindow,
} from '../github/repositorySearchQueries.js'
import { parseRepositoryUrl } from '../github/repositoryUrl.js'
import type { Log } from '../logging.js'
import { recordDiscoveryCandidate } from '../storage/discoveryCandidates.js'
import { recordDiscoverySourceOutcome } from '../storage/discoverySources.js'
import { createDiscoveryWriter } from '../storage/repositories.js'
import {
  ensureRepositorySearchPartition,
  pendingPushedPartitions,
  type RepositorySearchPartition,
  saveRepositorySearchPartition,
} from '../storage/repositorySearch.js'
import { runWhileActive } from '../storage/runs.js'

const MAX_REPOSITORY_SEARCH_REQUESTS = 20
const HISTORICAL_REQUEST_RESERVE = 5
// Keep most requests on recent work while guaranteeing room for due historical partitions.
const ROLLING_REQUEST_BUDGET = MAX_REPOSITORY_SEARCH_REQUESTS - HISTORICAL_REQUEST_RESERVE

export type RepositoryDiscoverySummary = {
  /** Completion of this invocation's configured due work, never GitHub-wide coverage. */
  state: 'complete' | 'incomplete' | 'not_due'
  totalResults: number
  partitions: number
  saturatedPartitions: number
  incompleteRollingPartitions: number
  warnings: string[]
  pagesFetched: number
  uniqueCandidates: number
  newUrls: number
  existingUrls: number
  completedPartitions: number
  incompletePartitions: number
}

type Work = {
  query: RepositorySearchQuery
  window: DateWindow
  partition: RepositorySearchPartition
  resumedRolling: boolean
}

function compareLastAttempt(left: Work, right: Work): number {
  const leftAttempt = left.partition.last_attempt_at
  const rightAttempt = right.partition.last_attempt_at
  if (leftAttempt === null && rightAttempt !== null) return 1
  if (leftAttempt !== null && rightAttempt === null) return -1
  return (leftAttempt ?? '').localeCompare(rightAttempt ?? '')
}

function schedulePushedWork(entries: Work[], afterQueryId?: string): Work[] {
  const queryIds = repositorySearchQueries.map(({ queryId }) => queryId)
  for (const { query } of entries) if (!queryIds.includes(query.queryId)) queryIds.push(query.queryId)
  const mostRecentlyAttempted = entries
    .filter(({ window, partition }) => window.field === 'pushed' && partition.last_attempt_at !== null)
    .sort((left, right) => Date.parse(right.partition.last_attempt_at ?? '') - Date.parse(left.partition.last_attempt_at ?? ''))[0]
    ?.query.queryId
  const rotateAfter = afterQueryId ?? mostRecentlyAttempted
  if (rotateAfter) {
    const current = queryIds.indexOf(rotateAfter)
    if (current >= 0) queryIds.push(...queryIds.splice(0, current + 1))
  }

  const byQuery = new Map<string, { resumed: Work[]; current: Work[] }>()
  for (const entry of entries) {
    if (entry.window.field !== 'pushed') continue
    const group = byQuery.get(entry.query.queryId) ?? { resumed: [], current: [] }
    group[entry.resumedRolling ? 'resumed' : 'current'].push(entry)
    byQuery.set(entry.query.queryId, group)
  }

  for (const group of byQuery.values()) {
    group.resumed.sort(
      (left, right) =>
        compareLastAttempt(left, right) ||
        left.window.start.localeCompare(right.window.start) ||
        left.window.end.localeCompare(right.window.end),
    )
    group.current.sort((left, right) => {
      if ((left.partition.last_attempt_at === null) !== (right.partition.last_attempt_at === null))
        return left.partition.last_attempt_at === null ? -1 : 1
      const attemptAge =
        (left.partition.last_attempt_at === null ? 0 : Date.parse(left.partition.last_attempt_at)) -
        (right.partition.last_attempt_at === null ? 0 : Date.parse(right.partition.last_attempt_at))
      if (attemptAge) return attemptAge
      return right.window.end.localeCompare(left.window.end) || right.window.start.localeCompare(left.window.start)
    })
  }

  const scheduled: Work[] = []
  let remaining = [...byQuery.values()].reduce((count, group) => count + group.resumed.length + group.current.length, 0)
  while (remaining > 0) {
    for (const queryId of queryIds) {
      const group = byQuery.get(queryId)
      if (!group) continue
      const resumed = group.resumed.shift()
      if (resumed) {
        scheduled.push(resumed)
        remaining--
      }
      const current = group.current.shift()
      if (current) {
        scheduled.push(current)
        remaining--
      }
    }
  }
  return scheduled
}

function scheduleCreatedWork(entries: Work[]): Work[] {
  const queryPosition = new Map(repositorySearchQueries.map(({ queryId }, index) => [queryId, index]))
  const intervalLength = (entry: Work) => Date.parse(entry.window.end) - Date.parse(entry.window.start)
  const queryPositionOf = (entry: Work) => queryPosition.get(entry.query.queryId) ?? Number.MAX_SAFE_INTEGER
  const incomplete = entries.filter(({ partition }) => partition.status !== 'complete')
  const complete = entries.filter(({ partition }) => partition.status === 'complete')

  incomplete.sort(
    (left, right) =>
      compareLastAttempt(left, right) ||
      left.window.start.localeCompare(right.window.start) ||
      intervalLength(right) - intervalLength(left) ||
      queryPositionOf(left) - queryPositionOf(right) ||
      left.window.end.localeCompare(right.window.end),
  )
  complete.sort(
    (left, right) =>
      Date.parse(left.partition.last_completed_at ?? '') - Date.parse(right.partition.last_completed_at ?? '') ||
      left.window.start.localeCompare(right.window.start) ||
      queryPositionOf(left) - queryPositionOf(right),
  )
  return [...incomplete, ...complete]
}

export async function discoverRepositories(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  onProgress?: () => void,
  now: () => string = () => new Date().toISOString(),
  log?: Log,
): Promise<RepositoryDiscoverySummary> {
  const at = now()
  const summary: RepositoryDiscoverySummary = {
    state: 'incomplete',
    totalResults: 0,
    partitions: 0,
    saturatedPartitions: 0,
    incompleteRollingPartitions: 0,
    warnings: [],
    pagesFetched: 0,
    uniqueCandidates: 0,
    newUrls: 0,
    existingUrls: 0,
    completedPartitions: 0,
    incompletePartitions: 0,
  }
  const writeDiscovery = createDiscoveryWriter(db)
  const countedUrls = new Map<string, number>()
  const completed = new Set<RepositorySearchPartition>()
  const attempted = new Set<RepositorySearchPartition>()
  const work: Work[] = []
  const refreshBefore = Date.parse(at) - 90 * 86_400_000
  function collect(query: RepositorySearchQuery, window: DateWindow): void {
    const partition = ensureRepositorySearchPartition(db, query.queryId, window)
    const children = partition.status === 'split' ? splitDateWindow(window) : null
    if (children) {
      for (const child of children) collect(query, child)
      return
    }
    if (
      window.field === 'created' &&
      partition.status === 'complete' &&
      partition.last_completed_at !== null &&
      Date.parse(partition.last_completed_at) > refreshBefore
    )
      return
    work.push({ query, window, partition, resumedRolling: false })
  }
  runWhileActive(db, runId, () => {
    for (const window of [rollingPushedWindow(at), ...historicalWindows(at)]) {
      for (const query of repositorySearchQueries) collect(query, window)
    }
    const currentWork = new Set(work.map(({ query, partition }) => `${query.queryId}/${partition.partition_key}`))
    const queriesById = new Map(repositorySearchQueries.map((query) => [query.queryId, query]))
    for (const partition of pendingPushedPartitions(db)) {
      const identity = `${partition.query_id}/${partition.partition_key}`
      const query = queriesById.get(partition.query_id)
      if (currentWork.has(identity) || !query) continue
      work.push({
        query,
        window: { field: 'pushed', start: partition.date_start, end: partition.date_end },
        partition,
        resumedRolling: true,
      })
      currentWork.add(identity)
    }
  })
  const initialPushed = schedulePushedWork(work)
  const initialCreated = scheduleCreatedWork(work.filter(({ window }) => window.field === 'created'))
  work.splice(0, work.length, ...initialPushed, ...initialCreated)

  const warnings = new Set<string>()
  const emitPartition = (entry: Work, reason: string) =>
    log?.({
      level:
        reason === 'request-budget' || entry.partition.status === 'incomplete' || entry.partition.status === 'pending' ? 'warn' : 'info',
      event: 'crawl.repository_search.partition',
      phase: 'discovery',
      category: 'partition_outcome',
      runId,
      source: 'repo_search',
      queryId: entry.query.queryId,
      queryVersion: repositorySearchQueryVersion,
      partitionKey: entry.partition.partition_key,
      state: !attempted.has(entry.partition) ? 'incomplete' : entry.partition.status,
      reason,
      pagesFetched: attempted.has(entry.partition) ? entry.partition.pages_fetched : 0,
      nextPage: entry.partition.next_page,
      totalCount: entry.partition.total_count,
      uniqueCandidates: entry.partition.candidate_count,
    })
  const finish = (failure = false) => {
    const unattempted = work.filter(
      ({ partition }) => partition.status !== 'split' && !completed.has(partition) && !attempted.has(partition),
    )
    if (summary.pagesFetched >= 20 && work.some(({ partition }) => partition.status !== 'split' && !completed.has(partition)))
      warnings.add('request-budget')
    // Emit an outcome for budget-skipped leaves too; old completion timestamps do not mean this run covered them.
    for (const entry of unattempted) emitPartition(entry, failure ? 'source-interrupted' : 'request-budget')
    summary.partitions = work.filter(({ partition }) => partition.status !== 'split').length
    summary.incompleteRollingPartitions = work.filter(
      ({ window, partition }) => window.field === 'pushed' && partition.status !== 'split' && !completed.has(partition),
    ).length
    if (failure) warnings.add('fatal-error')
    summary.warnings = [...warnings]
    summary.completedPartitions = completed.size
    summary.incompletePartitions = work.filter(({ partition }) => partition.status !== 'split' && !completed.has(partition)).length
    summary.state = work.length === 0 ? 'not_due' : summary.incompletePartitions === 0 ? 'complete' : 'incomplete'
    recordDiscoverySourceOutcome(
      db,
      runId,
      'repo_search',
      {
        ...summary,
        incompletePartitionIdentities: work
          .filter(({ partition }) => partition.status !== 'split' && !completed.has(partition))
          .map(({ query, partition }) => ({ queryId: query.queryId, partitionKey: partition.partition_key })),
      },
      now(),
      log,
    )
    log?.({
      level: summary.state === 'incomplete' ? 'warn' : 'info',
      event: failure ? 'crawl.repository_search.failed' : 'crawl.repository_search.completed',
      phase: 'discovery',
      category: failure ? 'source_failed' : 'source_completed',
      runId,
      source: 'repo_search',
      queryVersion: repositorySearchQueryVersion,
      queryId: 'catalog',
      partitionKey: 'catalog',
      ...summary,
    })
  }
  try {
    for (let index = 0; index < work.length; index++) {
      if (summary.pagesFetched >= MAX_REPOSITORY_SEARCH_REQUESTS) break
      if (summary.pagesFetched >= ROLLING_REQUEST_BUDGET) {
        const createdIndex = work.findIndex(
          ({ window, partition }, pendingIndex) => pendingIndex >= index && window.field === 'created' && partition.status !== 'split',
        )
        if (createdIndex >= 0 && createdIndex !== index) {
          const [createdWork] = work.splice(createdIndex, 1)
          if (createdWork) work.splice(index, 0, createdWork)
        }
      }
      const { query, window, partition } = work[index]
      if (summary.pagesFetched >= MAX_REPOSITORY_SEARCH_REQUESTS) break
      log?.({
        level: 'info',
        event: 'crawl.repository_search.started',
        phase: 'discovery',
        category: 'partition_started',
        runId,
        source: 'repo_search',
        queryId: query.queryId,
        queryVersion: repositorySearchQueryVersion,
        partitionKey: partition.partition_key,
        nextPage: partition.next_page,
      })
      attempted.add(partition)
      let reason = 'request-budget'
      const requestLimit =
        window.field === 'pushed' &&
        work.some((entry, pendingIndex) => pendingIndex > index && entry.window.field === 'created' && entry.partition.status !== 'split')
          ? ROLLING_REQUEST_BUDGET
          : MAX_REPOSITORY_SEARCH_REQUESTS
      const firstPage = partition.status === 'complete' || partition.next_page < 1 || partition.next_page > 10 ? 1 : partition.next_page
      Object.assign(partition, {
        status: 'incomplete',
        last_attempt_at: now(),
        pages_fetched: 0,
        next_page: firstPage,
        candidate_count: 0,
        incomplete_results: 0,
        saturated: 0,
      })
      runWhileActive(db, runId, () => saveRepositorySearchPartition(db, partition))
      const candidates = new Set<number>()
      for (let page = firstPage; page <= 10 && summary.pagesFetched < requestLimit; page++) {
        onProgress?.()
        summary.pagesFetched++
        partition.pages_fetched++
        runWhileActive(db, runId, () => saveRepositorySearchPartition(db, partition))
        let result: RepositorySearchPage
        try {
          const options = window.field === 'pushed' ? { maxAttempts: 1, sort: 'updated' as const } : { maxAttempts: 1 }
          result = await reader.searchRepositories(buildRepositorySearchQuery(query, window), page, options)
        } catch (error) {
          if (!(error instanceof GitHubTemporaryError) || error.status === 401 || error.status === 422) {
            emitPartition(work[index], 'fatal-error')
            throw error
          }
          reason = 'temporary-error'
          break
        }
        summary.totalResults += result.items.length
        const resultCountChanged = page > 1 && partition.total_count > 0 && partition.total_count !== result.total_count
        partition.total_count = result.total_count
        partition.incomplete_results ||= Number(result.incomplete_results)
        partition.saturated ||= Number(result.total_count >= 1000)
        const shortPageBeforeExpectedEnd = result.items.length < 100 && page * 100 < result.total_count
        runWhileActive(db, runId, () => {
          for (const item of result.items) {
            if (item.private || !parseRepositoryUrl(item.html_url)) continue
            const key = item.html_url.toLowerCase()
            let id = countedUrls.get(key)
            if (id === undefined) {
              const written = writeDiscovery(item.html_url, item.description, now(), item.node_id)
              id = written.id
              countedUrls.set(key, id)
              summary.uniqueCandidates++
              if (written.existing) summary.existingUrls++
              else summary.newUrls++
            }
            candidates.add(id)
            recordDiscoveryCandidate(db, runId, id, 'repo_search', query.queryId)
          }
          partition.candidate_count = candidates.size
          partition.next_page = page + 1
          if (partition.incomplete_results || resultCountChanged || shortPageBeforeExpectedEnd) partition.next_page = 1
          if (
            !partition.incomplete_results &&
            !partition.saturated &&
            !resultCountChanged &&
            !shortPageBeforeExpectedEnd &&
            (result.items.length < 100 || page * 100 >= result.total_count)
          ) {
            partition.status = 'complete'
            partition.last_completed_at = now()
          }
          saveRepositorySearchPartition(db, partition)
        })
        if (partition.saturated) {
          summary.saturatedPartitions++
          reason = 'saturated'
          const children = splitDateWindow(window)
          if (children) {
            runWhileActive(db, runId, () => {
              partition.status = 'split'
              saveRepositorySearchPartition(db, partition)
              const remaining = work.slice(index + 1)
              remaining.push(
                ...children.map((child) => ({
                  query,
                  window: child,
                  partition: ensureRepositorySearchPartition(db, query.queryId, child),
                  resumedRolling: work[index].resumedRolling,
                })),
              )
              const scheduled = [
                ...schedulePushedWork(
                  remaining.filter(({ window: pendingWindow }) => pendingWindow.field === 'pushed'),
                  query.queryId,
                ),
                ...scheduleCreatedWork(remaining.filter(({ window: pendingWindow }) => pendingWindow.field === 'created')),
              ]
              work.splice(index + 1, work.length - index - 1, ...scheduled)
            })
          }
          break
        }
        if (partition.incomplete_results) {
          reason = 'incomplete-results'
          break
        }
        if (resultCountChanged) {
          reason = 'result-count-changed'
          break
        }
        if (shortPageBeforeExpectedEnd) {
          reason = 'short-page-before-end'
          break
        }
        if (partition.status === 'complete') {
          reason = 'complete'
          break
        }
        if (result.items.length < 100) {
          reason = 'short-page'
          break
        }
      }
      if (partition.status === 'complete') completed.add(partition)
      else if (partition.status !== 'split') warnings.add(reason)
      emitPartition(work[index], reason)
      onProgress?.()
    }
  } catch (error) {
    finish(true)
    throw error
  }
  finish()

  return summary
}
