import type Database from 'better-sqlite3'
import { GitHubFatalError, type GitHubReader, GitHubTemporaryError } from '../github/client.js'
import { repositorySearchQueries } from '../github/repositorySearchQueries.js'
import type { SizeRange } from '../github/sizeRanges.js'
import type { Log } from '../logging.js'
import { ShutdownError, throwIfShutdown } from '../shutdown.js'
import { discoveryYield } from '../storage/discoveryCandidates.js'
import {
  beginRun,
  completeRun,
  failRun,
  getActiveRun,
  heartbeatRun,
  listRunErrors,
  PublicationLeaseError,
  RunNotActiveError,
  recordRunError,
  startRunPhase,
  terminateRun,
} from '../storage/runs.js'
import { type DiscoverySummary, discover } from './discover.js'
import { discoverRepositories } from './discoverRepositories.js'
import { type EnrichmentCounts, enrichRepositories, MAX_PENDING_CANDIDATES_PER_RUN } from './enrich.js'

export type RunCrawlOptions = {
  ranges?: readonly SizeRange[]
  now?: () => Date
  signal?: AbortSignal
  started?: boolean
  repositorySearchEnabled?: boolean
  log?: Log
  onPhase?: (phase: 'discovery' | 'enrichment') => void
}

export type DiscoverySourceSummary = {
  state: 'complete' | 'incomplete' | 'not_due'
  pagesFetched: number
  totalResults: number
  queries: number
  partitions: number
  incompletePartitions: number
  uniqueCandidates: number
  newUrls: number
  acceptedMarketplaces: number
  rejectedCandidates: number
  pendingCandidates: number
  saturatedPartitions: number
  warnings: string[]
}

export type CrawlDiscoverySummary = DiscoverySummary & {
  coverageScope: 'configured_query_catalog'
  sources: Record<'code_search' | 'repo_search', DiscoverySourceSummary>
  uniqueCandidates: number
  uniqueCatalogAdditions: number
}

export type CrawlSummary = {
  runId: string
  status: 'completed'
  discovery: CrawlDiscoverySummary
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
  | 'terminated'

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
  if (error instanceof RunNotActiveError) return 'run_not_active'
  if (error instanceof ShutdownError) return 'terminated'
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

function beginCrawl(db: Database.Database, runId: string, now: () => string): void {
  try {
    beginRun(db, runId, now())
  } catch (error) {
    if (error instanceof PublicationLeaseError) throw new CrawlError('publication_locked', { cause: error })
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE' && getActiveRun(db)) {
      throw new CrawlError('run_already_active', { cause: error })
    }
    throw new CrawlError('database_error', { cause: error })
  }
}

type RepositorySearchResult = Awaited<ReturnType<typeof discoverRepositories>>

async function discoverOptionalRepositories(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  options: RunCrawlOptions,
  heartbeat: () => void,
  now: () => string,
): Promise<RepositorySearchResult> {
  const emptyRepo = {
    state: 'not_due' as const,
    totalResults: 0,
    partitions: 0,
    saturatedPartitions: 0,
    incompleteRollingPartitions: 0,
    warnings: [] as string[],
    pagesFetched: 0,
    uniqueCandidates: 0,
    newUrls: 0,
    existingUrls: 0,
    completedPartitions: 0,
    incompletePartitions: 0,
  }
  let repo: RepositorySearchResult = emptyRepo
  if (options.repositorySearchEnabled) {
    try {
      repo = await discoverRepositories(db, reader, runId, heartbeat, now, options.log)
    } catch (error) {
      // A failed optional source must not abort successful Code Search coverage.
      // Shutdown and loss of database ownership still propagate.
      if (error instanceof ShutdownError || error instanceof RunNotActiveError || options.signal?.aborted) throw error
      if (!(error instanceof GitHubFatalError || error instanceof GitHubTemporaryError)) throw error
      options.log?.({
        level: 'warn',
        event: 'crawl.repository_search.optional_failure',
        phase: 'discovery',
        category: 'optional_source_failed',
        runId,
        message: 'Repository Search failed; continuing with Code Search results',
        reason: error instanceof Error ? error.message : 'unknown',
      })
      repo = { ...emptyRepo, state: 'incomplete', incompletePartitions: 1, warnings: ['optional-source-error'] }
    }
  }
  return repo
}

async function crawlAndComplete(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  options: RunCrawlOptions,
  now: () => string,
): Promise<CrawlSummary> {
  const heartbeat = () => {
    throwIfShutdown(options.signal)
    if (!heartbeatRun(db, runId, now())) throw new CrawlError('run_not_active')
  }
  throwIfShutdown(options.signal)
  startRunPhase(db, runId, 'discovery', now())
  options.onPhase?.('discovery')
  const acceptedRepositories = () =>
    db.prepare('SELECT id, html_url FROM repositories WHERE plugins_count > 0').all() as { id: number; html_url: string | null }[]
  const previousAccepted = acceptedRepositories()
  const previousAcceptedIds = new Set(previousAccepted.map(({ id }) => id))
  const previousAcceptedUrls = new Set(previousAccepted.map(({ html_url }) => html_url?.toLowerCase()))
  const codeMetrics = { pagesFetched: 0, totalResults: 0, partitions: 0, incompletePartitions: 0 }
  const code = await discover(db, reader, runId, options.ranges ?? [[0, 400_000]], heartbeat, now, options.log, codeMetrics)
  const repo = await discoverOptionalRepositories(db, reader, runId, options, heartbeat, now)
  const emptyYield = { uniqueCandidates: 0, acceptedMarketplaces: 0, rejectedCandidates: 0, pendingCandidates: 0 }
  const discovery: CrawlDiscoverySummary = {
    ...code,
    coverageScope: 'configured_query_catalog',
    uniqueCandidates: 0,
    uniqueCatalogAdditions: 0,
    sources: {
      code_search: {
        ...codeMetrics,
        ...emptyYield,
        state: codeMetrics.incompletePartitions ? 'incomplete' : codeMetrics.partitions ? 'complete' : 'not_due',
        queries: 2,
        newUrls: code.newUrls,
        saturatedPartitions: code.warnings.filter(({ category }) => category === 'saturated').length,
        warnings: [...new Set(code.warnings.map(({ category }) => category))],
      },
      repo_search: { ...repo, ...emptyYield, uniqueCandidates: repo.uniqueCandidates, queries: repositorySearchQueries.length },
    },
  }
  options.log?.({
    level: 'info',
    event: 'crawl.phase_completed',
    phase: 'discovery',
    category: 'phase_completed',
    runId,
    message: `Code Search completed: ${discovery.newUrls} new, ${discovery.existingUrls} existing, ${discovery.warningCount} warnings`,
    newRepositories: discovery.newUrls,
    existingRepositories: discovery.existingUrls,
    successfulRanges: discovery.successfulRanges,
    warningCount: discovery.warningCount,
    families: discovery.families,
  })
  heartbeat()
  const enrichmentTotal = (db.prepare('SELECT COUNT(*) AS count FROM repositories').get() as { count: number }).count
  startRunPhase(db, runId, 'enrichment', now(), enrichmentTotal)
  options.onPhase?.('enrichment')
  const enrichment = await enrichRepositories(db, reader, runId, heartbeat, now, options.log, MAX_PENDING_CANDIDATES_PER_RUN)
  options.log?.({
    level: 'info',
    event: 'crawl.phase_completed',
    phase: 'enrichment',
    category: 'phase_completed',
    runId,
    message: `Enrichment completed: ${enrichment.conclusive} conclusive, ${enrichment.unchangedOnError} kept unchanged after errors, ${enrichment.newIncomplete} incomplete, ${enrichment.deferredCandidates} candidates deferred by cap`,
    ...enrichment,
  })
  heartbeat()
  // Either discovery channel can sustain the run; Repository Search may be bounded/incomplete if it returned candidates.
  if (discovery.successfulRanges === 0 && repo.completedPartitions === 0 && repo.uniqueCandidates === 0)
    throw new CrawlError('no_successful_ranges')
  // An empty completed search has nothing to enrich; fail only when enrichment ran but no repository was conclusive.
  if (enrichment.conclusive === 0 && (enrichment.newIncomplete > 0 || enrichment.unchangedOnError > 0))
    throw new CrawlError('no_conclusive_enrichment')

  for (const source of ['code_search', 'repo_search'] as const) Object.assign(discovery.sources[source], discoveryYield(db, runId, source))
  discovery.uniqueCandidates = discoveryYield(db, runId).uniqueCandidates
  // A canonical merge can replace the row ID; a rename without a merge retains it.
  discovery.uniqueCatalogAdditions = acceptedRepositories().filter(
    ({ id, html_url }) => !previousAcceptedIds.has(id) && !previousAcceptedUrls.has(html_url?.toLowerCase()),
  ).length
  options.log?.({
    level: 'info',
    event: 'crawl.discovery_yield',
    phase: 'discovery',
    category: 'accepted_marketplaces',
    runId,
    coverageScope: discovery.coverageScope,
    sources: discovery.sources,
    uniqueCandidates: discovery.uniqueCandidates,
    uniqueCatalogAdditions: discovery.uniqueCatalogAdditions,
  })
  const errors = listRunErrors(db, runId)
  const errorCategories: Record<string, number> = {}
  for (const error of errors) {
    errorCategories[error.error_type] = (Object.hasOwn(errorCategories, error.error_type) ? errorCategories[error.error_type] : 0) + 1
  }
  const warningCount = errors.length + Number(repo.state === 'incomplete')
  if (!completeRun(db, runId, now(), warningCount)) throw new CrawlError('run_not_active')
  return { runId, status: 'completed', discovery, enrichment, warningCount, errorCategories }
}

function failCrawl(db: Database.Database, runId: string, error: unknown, category: CrawlFailureCategory, now: () => string): CrawlError {
  const failure = error instanceof CrawlError ? error : new CrawlError(category, { cause: error })
  if (category === 'run_not_active') return failure
  let persistenceError: unknown
  try {
    recordRunError(db, {
      run_id: runId,
      phase: 'crawl',
      error_type: category,
      retry_count: 0,
      occurred_at: now(),
    })
  } catch (error) {
    persistenceError = error
  }
  let failed = false
  try {
    failed = category === 'terminated' ? terminateRun(db, runId, now()) : failRun(db, runId, now(), category)
  } catch (error) {
    persistenceError ??= error
  }
  if (!failed && persistenceError === undefined) return new CrawlError('run_not_active')
  return persistenceError ? new CrawlError('database_error', { cause: persistenceError }) : failure
}

export async function runCrawl(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  options: RunCrawlOptions = {},
): Promise<CrawlSummary> {
  const now = () => (options.now ?? (() => new Date()))().toISOString()
  // The caller's stale-run threshold must allow for a single rate-limited request (or a full 50-row batch).
  if (options.started) {
    if (getActiveRun(db)?.run_id !== runId) throw new CrawlError('run_not_active')
  } else {
    beginCrawl(db, runId, now)
  }
  try {
    return await crawlAndComplete(db, reader, runId, options, now)
  } catch (error) {
    const category = failureCategory(error)
    throw failCrawl(db, runId, error, category, now)
  }
}
