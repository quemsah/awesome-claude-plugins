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

/** Read current-catalog leaves plus unfinished leaves from shifted rolling roots; ignore obsolete query versions. */
export function repositorySearchCoverage(db: Database.Database, at: string) {
  const rows = db
    .prepare('SELECT * FROM repository_search_partitions WHERE query_version = ?')
    .all(repositorySearchQueryVersion) as RepositorySearchPartition[]
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
  const incomplete = leaves.filter(({ row }) => row?.status !== 'complete')
  const stale = leaves.some(
    ({ row }) =>
      row?.status === 'complete' &&
      (!row.last_completed_at ||
        Date.parse(row.last_completed_at) <= Date.parse(at) - (row.date_field === 'created' ? 90 : 1) * 86_400_000),
  )
  const neverRun = leaves.every(({ row }) => !row?.last_attempt_at && !row?.last_completed_at)
  const freshness = neverRun ? 'never_run' : incomplete.length ? 'incomplete' : stale ? 'stale' : 'fresh'
  return {
    queryVersion: repositorySearchQueryVersion,
    freshness,
    due: freshness !== 'fresh',
    stale,
    lastCompleteScan: incomplete.length ? null : (leaves.map(({ row }) => row?.last_completed_at ?? null).sort()[0] ?? null),
    incompletePartitions: incomplete.length,
    warnings: [...(incomplete.length ? ['incomplete_partitions'] : []), ...(stale ? ['stale_partitions'] : [])],
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
