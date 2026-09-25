import type Database from 'better-sqlite3'
import { type GitHubReader, GitHubTemporaryError } from '../github/client.js'
import { parseRepositoryUrl } from '../github/repositoryUrl.js'
import type { SizeRange } from '../github/sizeRanges.js'
import { listCachedDiscoveryRanges, replaceCachedDiscoveryRanges } from '../storage/discoveryRanges.js'
import { upsertDiscovery } from '../storage/repositories.js'
import { recordRunError, runWhileActive } from '../storage/runs.js'

export type { SizeRange } from '../github/sizeRanges.js'

export type DiscoveryWarningCategory = 'saturated' | 'page-limit' | 'incomplete-results' | 'temporary-error' | 'invalid-url' | 'short-page'

export type DiscoveryWarning = { range: SizeRange; category: DiscoveryWarningCategory }

export type DiscoverySummary = {
  newUrls: number
  existingUrls: number
  /** A range counts after at least one successful search response, including an empty first page. */
  successfulRanges: number
  warningCount: number
  warnings: DiscoveryWarning[]
}

type RangeState = {
  runId: string
  range: SizeRange
  warned: Set<DiscoveryWarningCategory>
  countedUrls: Set<string>
  summary: DiscoverySummary
  now: () => string
}

type CoverageState = {
  complete: boolean
  leaves: SizeRange[]
}

function warn(db: Database.Database, state: RangeState, category: DiscoveryWarningCategory, retryCount = 0): void {
  if (state.warned.has(category)) return
  const [min, max] = state.range
  runWhileActive(db, state.runId, () => {
    recordRunError(db, {
      run_id: state.runId,
      phase: 'search',
      range_start: min,
      range_end: max,
      error_type: category,
      retry_count: retryCount,
      occurred_at: state.now(),
    })
  })
  state.warned.add(category)
  state.summary.warnings.push({ range: state.range, category })
  state.summary.warningCount++
}

async function searchPage(
  reader: GitHubReader,
  query: string,
  page: number,
  db: Database.Database,
  state: RangeState,
): Promise<Awaited<ReturnType<GitHubReader['searchCode']>> | null> {
  try {
    return await reader.searchCode(query, page)
  } catch (error) {
    if (!(error instanceof GitHubTemporaryError) || error.status === 401 || error.status === 422) throw error
    warn(db, state, 'temporary-error', error.retryCount)
    return null
  }
}

function processItems(
  db: Database.Database,
  lookup: Database.Statement,
  result: Awaited<ReturnType<GitHubReader['searchCode']>>,
  state: RangeState,
): void {
  for (const { repository } of result.items) {
    if (repository.private === true) continue
    const url = repository.html_url
    if (!parseRepositoryUrl(url)) {
      warn(db, state, 'invalid-url')
      continue
    }
    const existing = Boolean(lookup.get(url))
    runWhileActive(db, state.runId, () => {
      upsertDiscovery(db, url, repository.description, state.now(), repository.node_id)
    })
    const countKey = url.toLowerCase()
    if (state.countedUrls.has(countKey)) continue
    state.countedUrls.add(countKey)
    if (existing) state.summary.existingUrls++
    else state.summary.newUrls++
  }
}

function recordPageWarnings(
  db: Database.Database,
  result: Awaited<ReturnType<GitHubReader['searchCode']>>,
  page: number,
  state: RangeState,
): void {
  if (result.total_count >= 1000) warn(db, state, 'saturated')
  if (result.incomplete_results) warn(db, state, 'incomplete-results')
  if (page === 10 && result.items.length === 100) warn(db, state, 'page-limit')
}

async function splitRange(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  lookup: Database.Statement,
  [min, max]: SizeRange,
  summary: DiscoverySummary,
  now: () => string,
  onProgress: (() => void) | undefined,
  countedUrls: Set<string>,
  countedAsSuccessful: boolean,
  coverage: CoverageState,
): Promise<void> {
  if (countedAsSuccessful) summary.successfulRanges--
  onProgress?.()
  const middle = Math.floor((min + max) / 2)
  await searchRange(db, reader, runId, lookup, [min, middle], summary, now, coverage, onProgress, countedUrls)
  await searchRange(db, reader, runId, lookup, [middle + 1, max], summary, now, coverage, onProgress, countedUrls)
}

async function splitSaturatedRange(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  lookup: Database.Statement,
  range: SizeRange,
  summary: DiscoverySummary,
  now: () => string,
  onProgress: (() => void) | undefined,
  page: number,
  result: Awaited<ReturnType<GitHubReader['searchCode']>>,
  state: RangeState,
  countedUrls: Set<string>,
  coverage: CoverageState,
): Promise<boolean> {
  const [min, max] = range
  if (min >= max) return false
  const saturatedRange = result.total_count >= 1000
  const fullLastPage = page === 10 && result.items.length === 100
  if (!saturatedRange && !fullLastPage) return false
  if (result.incomplete_results) warn(db, state, 'incomplete-results')
  if (fullLastPage) processItems(db, lookup, result, state)
  await splitRange(db, reader, runId, lookup, range, summary, now, onProgress, countedUrls, page > 1, coverage)
  return true
}

async function searchCompletePage(
  reader: GitHubReader,
  query: string,
  page: number,
  db: Database.Database,
  state: RangeState,
  onProgress: (() => void) | undefined,
): Promise<Awaited<ReturnType<GitHubReader['searchCode']>> | null> {
  let result = await searchPage(reader, query, page, db, state)
  for (let retry = 0; result?.incomplete_results && retry < 2; retry++) {
    onProgress?.()
    result = await searchPage(reader, query, page, db, state)
  }
  return result
}

async function recoverIncompleteRange(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  lookup: Database.Statement,
  range: SizeRange,
  summary: DiscoverySummary,
  now: () => string,
  onProgress: (() => void) | undefined,
  page: number,
  result: Awaited<ReturnType<GitHubReader['searchCode']>>,
  state: RangeState,
  countedUrls: Set<string>,
  coverage: CoverageState,
): Promise<boolean> {
  if (!result.incomplete_results) return false
  warn(db, state, 'incomplete-results')
  const [min, max] = range
  if (min >= max) {
    if (page > 1) summary.successfulRanges--
    coverage.complete = false
    return true
  }
  await splitRange(db, reader, runId, lookup, range, summary, now, onProgress, countedUrls, page > 1, coverage)
  return true
}

async function searchRange(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  lookup: Database.Statement,
  range: SizeRange,
  summary: DiscoverySummary,
  now: () => string,
  coverage: CoverageState,
  onProgress?: () => void,
  countedUrls: Set<string> = new Set(),
): Promise<void> {
  const [min, max] = range
  const query = `filename:marketplace.json path:.claude-plugin size:${min}..${max}`
  const state: RangeState = { runId, range, warned: new Set(), countedUrls, summary, now }
  let found = 0
  let lastTotalCount = 0
  let sawShortPage = false
  let rangeComplete = true
  for (let page = 1; page <= 10; page++) {
    onProgress?.()
    let result = await searchCompletePage(reader, query, page, db, state, onProgress)
    if (!result) {
      rangeComplete = false
      break
    }
    if (
      !result.incomplete_results &&
      result.total_count < 1000 &&
      result.items.length < 100 &&
      found + result.items.length < result.total_count
    ) {
      onProgress?.()
      const retry = await searchCompletePage(reader, query, page, db, state, onProgress)
      if (retry && retry.items.length > result.items.length) result = retry
    }
    if (
      await recoverIncompleteRange(
        db,
        reader,
        runId,
        lookup,
        range,
        summary,
        now,
        onProgress,
        page,
        result,
        state,
        countedUrls,
        coverage,
      )
    )
      return
    if (
      await splitSaturatedRange(
        db,
        reader,
        runId,
        lookup,
        range,
        summary,
        now,
        onProgress,
        page,
        result,
        state,
        countedUrls,
        coverage,
      )
    )
      return
    if (page === 1) summary.successfulRanges++
    recordPageWarnings(db, result, page, state)
    processItems(db, lookup, result, state)
    lastTotalCount = result.total_count
    if (result.items.length < 100 && found + result.items.length < result.total_count) sawShortPage = true
    found += result.items.length
    if (result.items.length === 0 || found >= result.total_count) break
  }
  if (sawShortPage && found < lastTotalCount) {
    warn(db, state, 'short-page')
    if (min < max) {
      await splitRange(db, reader, runId, lookup, range, summary, now, onProgress, countedUrls, true, coverage)
      onProgress?.()
      return
    }
    rangeComplete = false
  }
  if (found < lastTotalCount) rangeComplete = false
  if (rangeComplete) coverage.leaves.push(range)
  else coverage.complete = false
  onProgress?.()
}

export async function discover(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  ranges: readonly SizeRange[] = [[0, 400_000]],
  onProgress?: () => void,
  now: () => string = () => new Date().toISOString(),
): Promise<DiscoverySummary> {
  const summary: DiscoverySummary = { newUrls: 0, existingUrls: 0, successfulRanges: 0, warningCount: 0, warnings: [] }
  const lookup = db.prepare('SELECT id FROM repositories WHERE html_url = ? COLLATE NOCASE LIMIT 1')
  const countedUrls = new Set<string>()

  for (const rootRange of ranges) {
    const cachedRanges = listCachedDiscoveryRanges(db, rootRange) ?? [rootRange]
    const coverage: CoverageState = { complete: true, leaves: [] }
    for (const range of cachedRanges) {
      await searchRange(db, reader, runId, lookup, range, summary, now, coverage, onProgress, countedUrls)
    }
    if (coverage.complete) {
      runWhileActive(db, runId, () => replaceCachedDiscoveryRanges(db, rootRange, coverage.leaves))
    }
    onProgress?.()
  }

  return summary
}
