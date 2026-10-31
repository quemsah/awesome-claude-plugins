import type Database from 'better-sqlite3'
import {
  type DateWindow,
  historicalWindows,
  partitionKey,
  repositorySearchQueries,
  repositorySearchQueryVersion,
  rollingPushedWindow,
  splitDateWindow,
} from '../github/repositorySearchQueries.js'
import { getSetting, setSetting } from './runs.js'

export type RepositorySearchPartition = {
  query_version: number
  query_id: string
  partition_key: string
  date_field: DateWindow['field']
  date_start: string
  date_end: string
  status: 'pending' | 'incomplete' | 'complete' | 'split'
  last_attempt_at: string | null
  last_completed_at: string | null
  total_count: number
  pages_fetched: number
  next_page: number
  candidate_count: number
  incomplete_results: number
  saturated: number
}

export function ensureRepositorySearchPartition(db: Database.Database, queryId: string, window: DateWindow): RepositorySearchPartition {
  const key = partitionKey(window)
  db.prepare(`
    INSERT OR IGNORE INTO repository_search_partitions
      (query_version, query_id, partition_key, date_field, date_start, date_end, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(repositorySearchQueryVersion, queryId, key, window.field, window.start, window.end)
  return db
    .prepare(`
    SELECT * FROM repository_search_partitions WHERE query_version = ? AND query_id = ? AND partition_key = ?
  `)
    .get(repositorySearchQueryVersion, queryId, key) as RepositorySearchPartition
}

export function saveRepositorySearchPartition(db: Database.Database, partition: RepositorySearchPartition): void {
  db.prepare(`
    UPDATE repository_search_partitions SET
      status = @status, last_attempt_at = @last_attempt_at, last_completed_at = @last_completed_at,
      total_count = @total_count, pages_fetched = @pages_fetched, next_page = @next_page, candidate_count = @candidate_count,
      incomplete_results = @incomplete_results, saturated = @saturated
    WHERE query_version = @query_version AND query_id = @query_id AND partition_key = @partition_key
  `).run(partition)
}

/** Persist the exact expired pushed leaves: a merged min/max span loses distinct gaps.
 * Replays are opt-in and bounded by the normal per-run Repository Search budget. */
export type ExpiredGap = {
  queryId: string
  dateStart: string
  dateEnd: string
  nextPage: number
  totalCount: number
  lastAttempt: string | null
}
const gapSetting = `repo_search_expired_gaps_v${repositorySearchQueryVersion}`
function gapKey(queryId: string, start: string, end: string): string {
  return `${queryId}/${partitionKey({ field: 'pushed', start, end })}`
}

export function expiredPushedGaps(db: Database.Database): Record<string, ExpiredGap> {
  const saved = getSetting(db, gapSetting)
  if (!saved) return {}
  const parsed = JSON.parse(saved) as Record<string, ExpiredGap | { firstDate: string; lastDate: string; expiredLeaves: number }>
  const gaps: Record<string, ExpiredGap> = {}
  for (const [key, value] of Object.entries(parsed)) {
    // Conservative compatibility for databases used with the earlier pre-merge
    // prototype. Exact disjoint ranges cannot be reconstructed; replay their envelope.
    if ('firstDate' in value) {
      const newKey = gapKey(key, value.firstDate, value.lastDate)
      gaps[newKey] = {
        queryId: key, dateStart: value.firstDate, dateEnd: value.lastDate,
        nextPage: 1, totalCount: 0, lastAttempt: null,
      }
    } else gaps[key] = value
  }
  return gaps
}

export function expiredPushedGapCount(db: Database.Database): number {
  return Object.keys(expiredPushedGaps(db)).length
}

export function clearVerifiedExpiredGap(db: Database.Database, queryId: string, window: DateWindow): void {
  const gaps = expiredPushedGaps(db)
  const key = gapKey(queryId, window.start, window.end)
  if (!Object.hasOwn(gaps, key)) return
  delete gaps[key]
  setSetting(db, gapSetting, JSON.stringify(gaps))
}

/** A saturated expired leaf needs smaller exact gaps, not a falsely cleared parent. */
export function splitExpiredGap(db: Database.Database, queryId: string, parent: DateWindow, children: readonly DateWindow[]): void {
  const gaps = expiredPushedGaps(db)
  const key = gapKey(queryId, parent.start, parent.end)
  if (!Object.hasOwn(gaps, key)) return
  delete gaps[key]
  for (const child of children) {
    gaps[gapKey(queryId, child.start, child.end)] = {
      queryId, dateStart: child.start, dateEnd: child.end,
      nextPage: 1, totalCount: 0, lastAttempt: null,
    }
  }
  setSetting(db, gapSetting, JSON.stringify(gaps))
}

/** Prune expired checkpoints only after atomically recording their exact dates,
 * pagination cursor and latest attempt for a later explicitly enabled replay. */
export function pruneExpiredPushedPartitions(db: Database.Database, activeWindowStart: string): number {
  return db.transaction(() => {
    const rows = db
      .prepare(`SELECT query_id, date_start, date_end, next_page, total_count, last_attempt_at
        FROM repository_search_partitions
        WHERE query_version = ? AND date_field = 'pushed'
          AND date_end < ? AND status IN ('pending', 'incomplete')`)
      .all(repositorySearchQueryVersion, activeWindowStart) as Array<{
        query_id: string
        date_start: string
        date_end: string
        next_page: number
        total_count: number
        last_attempt_at: string | null
      }>
    if (rows.length) {
      const gaps = expiredPushedGaps(db)
      for (const row of rows) {
        gaps[gapKey(row.query_id, row.date_start, row.date_end)] = {
          queryId: row.query_id,
          dateStart: row.date_start,
          dateEnd: row.date_end,
          nextPage: row.next_page,
          totalCount: row.total_count,
          lastAttempt: row.last_attempt_at,
        }
      }
      setSetting(db, gapSetting, JSON.stringify(gaps))
    }
    return db
      .prepare(`DELETE FROM repository_search_partitions
      WHERE query_version = ? AND date_field = 'pushed' AND date_end < ?`)
      .run(repositorySearchQueryVersion, activeWindowStart).changes
  })()
}

/** Pending leaves from earlier rolling roots remain resumable as the 30-day window moves. */
export function pendingPushedPartitions(db: Database.Database): RepositorySearchPartition[] {
  const currentQueries = new Set(repositorySearchQueries.map(({ queryId }) => queryId))
  return (
    db
      .prepare(`
      SELECT * FROM repository_search_partitions
      WHERE query_version = ? AND date_field = 'pushed' AND status IN ('pending', 'incomplete')
      ORDER BY date_start, query_id, date_end
    `)
      .all(repositorySearchQueryVersion) as RepositorySearchPartition[]
  ).filter((partition) => currentQueries.has(partition.query_id))
}

type CoverageLeaf = { queryId: string; partitionKey: string; row?: RepositorySearchPartition }

function collectCoverageLeaves(rows: readonly RepositorySearchPartition[], at: string): CoverageLeaf[] {
  const indexed = new Map(rows.map((row) => [`${row.query_id}/${row.partition_key}`, row]))
  const leaves: Array<{ queryId: string; partitionKey: string; row?: RepositorySearchPartition }> = []
  function collect(queryId: string, window: DateWindow) {
    const key = partitionKey(window)
    const row = indexed.get(`${queryId}/${key}`)
    const children = row?.status === 'split' ? splitDateWindow(window) : null
    if (children) {
      for (const child of children) collect(queryId, child)
      return
    }
    leaves.push({ queryId, partitionKey: key, row })
  }
  for (const window of [rollingPushedWindow(at), ...historicalWindows(at)])
    for (const query of repositorySearchQueries) collect(query.queryId, window)
  const currentLeaves = new Set(leaves.map(({ queryId, partitionKey: key }) => `${queryId}/${key}`))
  for (const row of rows) {
    const identity = `${row.query_id}/${row.partition_key}`
    if (
      row.date_field === 'pushed' &&
      (row.status === 'pending' || row.status === 'incomplete') &&
      repositorySearchQueries.some(({ queryId }) => queryId === row.query_id) &&
      !currentLeaves.has(identity)
    ) {
      leaves.push({ queryId: row.query_id, partitionKey: row.partition_key, row })
      currentLeaves.add(identity)
    }
  }
  return leaves
}

/** Read current-catalog leaves plus unfinished leaves from shifted rolling roots; ignore obsolete query versions. */
export function repositorySearchCoverage(db: Database.Database, at: string) {
  const rows = db
    .prepare('SELECT * FROM repository_search_partitions WHERE query_version = ?')
    .all(repositorySearchQueryVersion) as RepositorySearchPartition[]
  const leaves = collectCoverageLeaves(rows, at)
  const incomplete = leaves.filter(({ row }) => row?.status !== 'complete')
  const unreconciledGaps = expiredPushedGaps(db)
  const expiredLeafCount = expiredPushedGapCount(db)
  const stale = leaves.some(
    ({ row }) =>
      row?.status === 'complete' &&
      (!row.last_completed_at ||
        Date.parse(row.last_completed_at) <= Date.parse(at) - (row.date_field === 'created' ? 90 : 1) * 86_400_000),
  )
  const neverRun = leaves.every(({ row }) => !row?.last_attempt_at && !row?.last_completed_at)
  const freshness = expiredLeafCount ? 'incomplete' : neverRun ? 'never_run' : incomplete.length ? 'incomplete' : stale ? 'stale' : 'fresh'
  return {
    queryVersion: repositorySearchQueryVersion,
    freshness,
    due: freshness !== 'fresh',
    stale,
    lastCompleteScan:
      incomplete.length || expiredLeafCount ? null : (leaves.map(({ row }) => row?.last_completed_at ?? null).sort()[0] ?? null),
    incompletePartitions: incomplete.length + expiredLeafCount,
    expiredRollingGaps: unreconciledGaps,
    warnings: [
      ...(incomplete.length ? ['incomplete_partitions'] : []),
      ...(expiredLeafCount ? ['expired_rolling_gaps_require_reconciliation'] : []),
      ...(stale ? ['stale_partitions'] : []),
    ],
    partitions: incomplete.map(({ queryId, partitionKey: key, row }) => ({
      queryId,
      queryVersion: repositorySearchQueryVersion,
      partitionKey: key,
      state: row?.status ?? 'pending',
      lastAttempt: row?.last_attempt_at ?? null,
      nextPage: row?.next_page ?? 1,
      incompleteResults: Boolean(row?.incomplete_results),
      saturated: Boolean(row?.saturated),
    })),
  }
}
