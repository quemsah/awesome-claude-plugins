import type Database from 'better-sqlite3'
import type { EnrichmentCounts } from '../crawl/enrich.js'
import { CrawlError, type CrawlSummary, runCrawl } from '../crawl/runCrawl.js'
import type { GitHubReader } from '../github/client.js'
import type { GitHubRateBuckets } from '../github/rateBudget.js'
import type { SizeRange } from '../github/sizeRanges.js'
import type { TelegramSummary } from '../notify/telegram.js'
import { TelegramNotificationError, type TelegramNotifier } from '../notify/telegram.js'
import type { GitHubGit } from '../publish/githubGit.js'
import { PublicationError, prepareDraft, publishRun } from '../publish/publishRun.js'
import { ShutdownError } from '../shutdown.js'
import { listPublishable } from '../storage/repositories.js'
import { getActiveRun, getRun, getSetting, listRunErrors, recordRunError, setSetting } from '../storage/runs.js'

export class ActiveRunError extends Error {
  readonly category = 'active_run'

  constructor() {
    super('Publication refused: active_run')
    this.name = 'ActiveRunError'
  }
}

export type Notifier = Pick<TelegramNotifier, 'notifyStart' | 'notifyFailure' | 'notifyDryRun' | 'notifySuccess'>
export type LogEvent = { level: 'error' | 'info'; phase: string; category: string; runId?: string }
export type ExecuteOptions = {
  now?: () => Date
  signal?: AbortSignal
  notifier?: Notifier
  log?: (event: LogEvent) => void
}
export type CrawlOptions = ExecuteOptions & {
  ranges?: readonly SizeRange[]
  dryRun: boolean
  started?: boolean
  git?: GitHubGit
  rateBuckets?: () => GitHubRateBuckets
}

export type RunReport = Pick<CrawlSummary, 'discovery' | 'enrichment' | 'warningCount' | 'errorCategories'> & {
  rateBuckets?: GitHubRateBuckets
  durationMs?: number
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isEnrichment(value: unknown): value is EnrichmentCounts {
  return (
    record(value) &&
    ['updated', 'unchangedOnError', 'newReady', 'newIncomplete', 'deleted404', 'deletedBlankUrl', 'conclusive', 'warnings'].every(
      (field) => Number.isSafeInteger(value[field]) && typeof value[field] === 'number' && value[field] >= 0,
    )
  )
}

function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isDiscovery(value: unknown): value is RunReport['discovery'] {
  return (
    record(value) &&
    nonnegative(value.newUrls) &&
    nonnegative(value.existingUrls) &&
    nonnegative(value.successfulRanges) &&
    nonnegative(value.warningCount) &&
    Array.isArray(value.warnings) &&
    value.warnings.every(
      (warning: unknown) =>
        record(warning) &&
        Array.isArray(warning.range) &&
        warning.range.length === 2 &&
        warning.range.every(nonnegative) &&
        typeof warning.category === 'string' &&
        ['saturated', 'page-limit', 'incomplete-results', 'temporary-error', 'invalid-url', 'short-page'].includes(warning.category),
    )
  )
}

function storedReport(db: Database.Database, runId: string): Partial<RunReport> | null {
  const raw = getSetting(db, `run_report_${runId}`)
  if (raw === null) return null
  const value: unknown = JSON.parse(raw)
  if (isEnrichment(value)) return { enrichment: value }
  if (
    !record(value) ||
    !isEnrichment(value.enrichment) ||
    !record(value.errorCategories) ||
    !isDiscovery(value.discovery) ||
    !nonnegative(value.warningCount)
  ) {
    throw new Error('Invalid stored crawl report')
  }
  if (
    !Object.entries(value.errorCategories).every(
      ([name, count]) => /^[a-z][a-z0-9_-]{0,63}$/.test(name) && typeof count === 'number' && Number.isSafeInteger(count) && count >= 0,
    )
  ) {
    throw new Error('Invalid stored crawl error categories')
  }
  const rate = value.rateBuckets
  if (
    rate !== undefined &&
    (!record(rate) ||
      !['code_search', 'core'].every((bucket) => {
        const entry = rate[bucket]
        return (
          record(entry) &&
          typeof entry.requests === 'number' &&
          Number.isSafeInteger(entry.requests) &&
          entry.requests >= 0 &&
          typeof entry.waitMs === 'number' &&
          Number.isSafeInteger(entry.waitMs) &&
          entry.waitMs >= 0 &&
          (entry.lastRemaining === null ||
            (typeof entry.lastRemaining === 'number' && Number.isSafeInteger(entry.lastRemaining) && entry.lastRemaining >= 0))
        )
      }))
  ) {
    throw new Error('Invalid stored GitHub rate report')
  }
  if (value.durationMs !== undefined && !nonnegative(value.durationMs)) throw new Error('Invalid stored crawl duration')
  return {
    discovery: value.discovery,
    enrichment: value.enrichment,
    warningCount: value.warningCount,
    errorCategories: value.errorCategories as Record<string, number>,
    ...(rate === undefined ? {} : { rateBuckets: rate as GitHubRateBuckets }),
    ...(value.durationMs === undefined ? {} : { durationMs: value.durationMs }),
  }
}

function category(error: unknown): string {
  if (error instanceof CrawlError || error instanceof PublicationError || error instanceof ActiveRunError) return error.category
  return 'execution_error'
}

function errorCategories(
  errors: ReturnType<typeof listRunErrors>,
  counts: CrawlSummary | undefined,
  saved: Partial<RunReport> | null,
): Record<string, number> {
  const categories = counts?.errorCategories ?? saved?.errorCategories ?? {}
  if (counts || saved?.errorCategories) return categories
  for (const error of errors) categories[error.error_type] = (categories[error.error_type] ?? 0) + 1
  return categories
}

function problematicRanges(errors: ReturnType<typeof listRunErrors>): string[] {
  return [
    ...new Set(
      errors
        .filter((error) => error.phase === 'search' && error.range_start !== null && error.range_end !== null)
        .map((error) => `size:${error.range_start}..${error.range_end}`),
    ),
  ]
}

function summary(db: Database.Database, runId: string, counts?: CrawlSummary, buckets?: GitHubRateBuckets): TelegramSummary {
  const errors = listRunErrors(db, runId)
  const run = getRun(db, runId)
  const saved = storedReport(db, runId)
  const report = counts?.enrichment ?? saved?.enrichment
  const categories = errorCategories(errors, counts, saved)
  return {
    runId,
    catalogSize: run?.draft_size ?? listPublishable(db).length,
    newCount: report?.newReady ?? 0,
    deletedCount: (report?.deleted404 ?? 0) + (report?.deletedBlankUrl ?? 0),
    skippedCount: (report?.unchangedOnError ?? 0) + (report?.newIncomplete ?? 0),
    ...(report ? { enrichment: report } : {}),
    ...(counts || saved || Object.keys(categories).length ? { errorCategories: categories } : {}),
    ...((buckets ?? saved?.rateBuckets) ? { rateBuckets: buckets ?? saved?.rateBuckets } : {}),
    ...(saved?.durationMs === undefined ? {} : { durationMs: saved.durationMs }),
    problematicRanges: problematicRanges(errors),
  }
}

function logDelivery(db: Database.Database, runId: string, now: () => Date, log: (event: LogEvent) => void, error: unknown): void {
  if (error instanceof ShutdownError) return
  const failure = error instanceof TelegramNotificationError ? error.category : 'delivery_failed'
  log({ level: 'error', phase: 'notify', category: failure, runId })
  if (!getRun(db, runId)) return
  try {
    recordRunError(db, { run_id: runId, phase: 'notify', error_type: failure, retry_count: 0, occurred_at: now().toISOString() })
  } catch {
    log({ level: 'error', phase: 'notify', category: 'record_error_failed', runId })
  }
}

async function notifyFailure(
  db: Database.Database,
  runId: string,
  reason: string,
  notifier: Notifier | undefined,
  now: () => Date,
  log: (event: LogEvent) => void,
  counts?: CrawlSummary,
  buckets?: GitHubRateBuckets,
): Promise<void> {
  log({ level: 'error', phase: 'execute', category: reason, runId })
  if (!notifier) return
  try {
    await notifier.notifyFailure({ ...summary(db, runId, counts, buckets), reason })
  } catch (error) {
    logDelivery(db, runId, now, log, error)
  }
}

function guardGit(db: Database.Database, git: GitHubGit, onBlocked: () => void, signal?: AbortSignal): GitHubGit {
  const check = () => {
    if (signal?.aborted) throw new PublicationError('terminated')
    if (getActiveRun(db)) {
      onBlocked()
      throw new ActiveRunError()
    }
  }
  return {
    getBranchHead: () => {
      check()
      return git.getBranchHead()
    },
    createTree: (baseTreeSha, files) => {
      check()
      return git.createTree(baseTreeSha, files)
    },
    createCommit: (treeSha, parentSha, message) => {
      check()
      return git.createCommit(treeSha, parentSha, message)
    },
    updateBranch: (sha) => {
      check()
      return git.updateBranch(sha)
    },
    isCommitReachable: (sha) => {
      check()
      return git.isCommitReachable(sha)
    },
  }
}

function recordPublishFailure(db: Database.Database, runId: string, reason: string, now: () => Date, log: (event: LogEvent) => void): void {
  if (!getRun(db, runId)) return
  try {
    recordRunError(db, { run_id: runId, phase: 'publish', error_type: reason, retry_count: 0, occurred_at: now().toISOString() })
  } catch {
    log({ level: 'error', phase: 'publish', category: 'record_error_failed', runId })
  }
}

async function notifyPublishSuccess(
  db: Database.Database,
  runId: string,
  sha: string,
  notifier: Notifier | undefined,
  now: () => Date,
  log: (event: LogEvent) => void,
): Promise<void> {
  if (!notifier) return
  try {
    await notifier.notifySuccess({ ...summary(db, runId), confirmedGitSha: sha })
  } catch (error) {
    logDelivery(db, runId, now, log, error)
  }
}

export async function executePublish(
  db: Database.Database,
  git: GitHubGit,
  runId: string,
  options: ExecuteOptions & { writeEnabled: true; recover?: boolean },
): Promise<{ status: 'published'; runId: string; sha: string; report?: Partial<RunReport> }> {
  const now = options.now ?? (() => new Date())
  const log = options.log ?? ((event: LogEvent) => console.error(JSON.stringify(event)))
  let sha: string
  let blocked = false
  const report = storedReport(db, runId)
  try {
    if (getActiveRun(db)) throw new ActiveRunError()
    sha = await publishRun(
      db,
      guardGit(
        db,
        git,
        () => {
          blocked = true
        },
        options.signal,
      ),
      runId,
      { writeEnabled: options.writeEnabled, recover: options.recover, now },
    )
  } catch (error) {
    const failure = blocked ? new ActiveRunError() : error
    const reason = category(failure)
    recordPublishFailure(db, runId, reason, now, log)
    await notifyFailure(db, runId, reason, options.notifier, now, log)
    throw failure
  }
  await notifyPublishSuccess(db, runId, sha, options.notifier, now, log)
  return { status: 'published', runId, sha, ...(report ? { report } : {}) }
}

async function notifyCrawlStart(db: Database.Database, runId: string, notifier: Notifier | undefined): Promise<unknown> {
  if (!notifier) return undefined
  try {
    await notifier.notifyStart(summary(db, runId))
    return undefined
  } catch (error) {
    return error
  }
}

async function crawlAndPrepare(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  options: CrawlOptions,
  now: () => Date,
  onCrawlComplete: (counts: CrawlSummary) => void,
): Promise<{ counts: CrawlSummary; size: number; report: RunReport }> {
  const crawlStartedAt = performance.now()
  const counts = await runCrawl(db, reader, runId, {
    ranges: options.ranges,
    now,
    signal: options.signal,
    started: options.started,
  })
  onCrawlComplete(counts)
  const size = prepareDraft(db, runId, now()).size
  const report: RunReport = {
    discovery: counts.discovery,
    enrichment: counts.enrichment,
    warningCount: counts.warningCount,
    errorCategories: counts.errorCategories,
    ...(options.rateBuckets ? { rateBuckets: options.rateBuckets() } : {}),
    durationMs: Math.round(performance.now() - crawlStartedAt),
  }
  setSetting(db, `run_report_${runId}`, JSON.stringify(report))
  return { counts, size, report }
}

async function handleCrawlFailure(
  db: Database.Database,
  runId: string,
  error: unknown,
  counts: CrawlSummary | undefined,
  options: CrawlOptions,
  now: () => Date,
  log: (event: LogEvent) => void,
): Promise<void> {
  if (counts && getRun(db, runId)) {
    try {
      recordRunError(db, {
        run_id: runId,
        phase: 'publish',
        error_type: category(error),
        retry_count: 0,
        occurred_at: now().toISOString(),
      })
    } catch {
      log({ level: 'error', phase: 'publish', category: 'record_error_failed', runId })
    }
  }
  await notifyFailure(db, runId, category(error), options.notifier, now, log, counts, options.rateBuckets?.())
}

async function notifyDryRun(
  db: Database.Database,
  runId: string,
  counts: CrawlSummary,
  options: CrawlOptions,
  now: () => Date,
  log: (event: LogEvent) => void,
): Promise<void> {
  if (!options.notifier) return
  try {
    await options.notifier.notifyDryRun(summary(db, runId, counts, options.rateBuckets?.()))
  } catch (error) {
    logDelivery(db, runId, now, log, error)
  }
}

export async function executeCrawl(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  options: CrawlOptions,
): Promise<
  | { status: 'draft'; runId: string; size: number; report: RunReport }
  | { status: 'published'; runId: string; sha: string; report: RunReport }
> {
  const now = options.now ?? (() => new Date())
  const log = options.log ?? ((event: LogEvent) => console.error(JSON.stringify(event)))
  const startError = await notifyCrawlStart(db, runId, options.notifier)
  let counts: CrawlSummary | undefined
  let startRecorded = false
  let prepared: { counts: CrawlSummary; size: number; report: RunReport }
  try {
    prepared = await crawlAndPrepare(db, reader, runId, options, now, (completedCounts) => {
      counts = completedCounts
      if (startError) {
        logDelivery(db, runId, now, log, startError)
        startRecorded = true
      }
    })
    counts = prepared.counts
  } catch (error) {
    if (startError && !startRecorded) logDelivery(db, runId, now, log, startError)
    await handleCrawlFailure(db, runId, error, counts, options, now, log)
    throw error
  }
  if (options.signal?.aborted) throw new PublicationError('terminated')
  if (options.dryRun) {
    await notifyDryRun(db, runId, prepared.counts, options, now, log)
    return { status: 'draft', runId, size: prepared.size, report: prepared.report }
  }
  if (!options.git) {
    await notifyFailure(db, runId, 'write_disabled', options.notifier, now, log, prepared.counts)
    throw new PublicationError('write_disabled')
  }
  const published = await executePublish(db, options.git, runId, {
    now,
    notifier: options.notifier,
    log,
    signal: options.signal,
    writeEnabled: true,
  })
  return { status: 'published', runId, sha: published.sha, report: prepared.report }
}
