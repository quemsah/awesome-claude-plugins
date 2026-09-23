import type Database from 'better-sqlite3'
import { GitHubFatalError, type GitHubReader, GitHubTemporaryError } from '../github/client.js'
import { SIZE_RANGES, type SizeRange } from '../github/sizeRanges.js'
import {
  beginRun,
  completeRun,
  failRun,
  getActiveRun,
  heartbeatRun,
  listRunErrors,
  PublicationLeaseError,
  recordRunError,
} from '../storage/runs.js'
import { type DiscoverySummary, discover } from './discover.js'
import { type EnrichmentCounts, enrichRepositories } from './enrich.js'

export type RunCrawlOptions = {
  ranges?: readonly SizeRange[]
  now?: () => Date
}

export type CrawlSummary = {
  runId: string
  status: 'completed'
  discovery: DiscoverySummary
  enrichment: EnrichmentCounts
  warningCount: number
  errorCategories: Record<string, number>
}

export type CrawlFailureCategory =
  | 'no_successful_ranges'
  | 'no_conclusive_enrichment'
  | 'github_fatal_error'
  | 'database_error'
  | 'crawl_error'
  | 'run_not_active'
  | 'run_already_active'
  | 'publication_locked'

export class CrawlError extends Error {
  constructor(
    readonly category: CrawlFailureCategory,
    options?: ErrorOptions,
  ) {
    super(`Crawl failed: ${category}`, options)
    this.name = 'CrawlError'
  }
}

function failureCategory(error: unknown): CrawlFailureCategory {
  if (error instanceof CrawlError) return error.category
  if (error instanceof GitHubFatalError) return 'github_fatal_error'
  if (error instanceof GitHubTemporaryError && (error.status === 401 || error.status === 422)) return 'github_fatal_error'
  if (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('SQLITE_')
  ) {
    return 'database_error'
  }
  return 'crawl_error'
}

export async function runCrawl(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  options: RunCrawlOptions = {},
): Promise<CrawlSummary> {
  const now = () => (options.now ?? (() => new Date()))().toISOString()
  // The caller's stale-run threshold must allow for a single rate-limited request (or a full 50-row batch).
  try {
    beginRun(db, runId, now())
  } catch (error) {
    if (error instanceof PublicationLeaseError) throw new CrawlError('publication_locked', { cause: error })
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE' && getActiveRun(db)) {
      throw new CrawlError('run_already_active', { cause: error })
    }
    throw new CrawlError('database_error', { cause: error })
  }
  try {
    const heartbeat = () => {
      if (!heartbeatRun(db, runId, now())) throw new CrawlError('run_not_active')
    }
    const discovery = await discover(db, reader, runId, options.ranges ?? SIZE_RANGES, heartbeat)
    heartbeat()
    const enrichment = await enrichRepositories(db, reader, runId, heartbeat)
    heartbeat()

    if (discovery.successfulRanges === 0) throw new CrawlError('no_successful_ranges')
    if (enrichment.conclusive === 0) throw new CrawlError('no_conclusive_enrichment')

    const errors = listRunErrors(db, runId)
    const errorCategories: Record<string, number> = {}
    for (const error of errors) {
      errorCategories[error.error_type] = (Object.hasOwn(errorCategories, error.error_type) ? errorCategories[error.error_type] : 0) + 1
    }
    if (!completeRun(db, runId, now(), errors.length)) throw new CrawlError('run_not_active')

    return {
      runId,
      status: 'completed',
      discovery,
      enrichment,
      warningCount: errors.length,
      errorCategories,
    }
  } catch (error) {
    const category = failureCategory(error)
    const failure = error instanceof CrawlError ? error : new CrawlError(category, { cause: error })
    if (category === 'run_not_active') throw failure
    let persistenceError: unknown
    try {
      recordRunError(db, {
        run_id: runId,
        phase: 'crawl',
        error_type: category,
        retry_count: 0,
        occurred_at: now(),
      })
    } catch (recordError) {
      persistenceError = recordError
    }
    try {
      if (!failRun(db, runId, now(), category)) throw new CrawlError('run_not_active')
    } catch (markError) {
      persistenceError ??= markError
    }
    if (persistenceError) throw new CrawlError('database_error', { cause: persistenceError })
    throw failure
  }
}
