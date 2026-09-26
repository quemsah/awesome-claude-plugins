import type Database from 'better-sqlite3'
import type { EnrichmentCounts } from '../crawl/enrich.js'
import { CrawlError, type CrawlSummary, runCrawl } from '../crawl/runCrawl.js'
import type { GitHubReader } from '../github/client.js'
import type { GitHubRateBuckets } from '../github/rateBudget.js'
import type { SizeRange } from '../github/sizeRanges.js'
import type { LogEvent } from '../logging.js'
import type { TelegramSummary } from '../notify/telegram.js'
import { TelegramNotificationError, type TelegramNotifier } from '../notify/telegram.js'
import type { GitHubGit } from '../publish/githubGit.js'
import { PublicationError, prepareDraft, publishRun } from '../publish/publishRun.js'
import { ShutdownError } from '../shutdown.js'
import { inspectProgress } from '../storage/progress.js'
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

function nullableNonnegative(value: unknown): boolean {
  return value === null || nonnegative(value)
}

function optionalNonnegative(value: unknown): boolean {
  return value === undefined || nonnegative(value)
}

function validGraphQLRate(value: unknown): boolean {
  if (!record(value)) return false
  const countersValid = ['requests', 'waitMs', 'totalCost'].every((field) => nonnegative(value[field]))
  const nullableCountersValid = ['lastRemaining', 'lastCost', 'lastLimit', 'lastUsed'].every((field) => nullableNonnegative(value[field]))
  const latencyValid =
    optionalNonnegative(value.totalLatencyMs) &&
    optionalNonnegative(value.latencySamples) &&
    (value.lastLatencyMs === undefined || nullableNonnegative(value.lastLatencyMs))
  const resetValid = value.resetAt === null || (typeof value.resetAt === 'string' && !Number.isNaN(Date.parse(value.resetAt)))
  return countersValid && nullableCountersValid && latencyValid && resetValid
}

function validRateBucket(value: unknown): boolean {
  return record(value) && nonnegative(value.requests) && nonnegative(value.waitMs) && nullableNonnegative(value.lastRemaining)
}

function validRateBuckets(value: unknown): boolean {
  if (!record(value)) return false
  if (!['code_search', 'core'].every((bucket) => validRateBucket(value[bucket]))) return false
  return !Object.hasOwn(value, 'graphql') || validGraphQLRate(value.graphql)
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
  if (rate !== undefined && !validRateBuckets(rate)) throw new Error('Invalid stored GitHub rate report')
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

function telegramProgress(db: Database.Database, runId: string, includeProgress: boolean): TelegramSummary['progress'] {
  if (!includeProgress) return undefined
  const progress = inspectProgress(db)
  if (progress.run?.runId !== runId) return undefined
  return {
    repositories: {
      total: progress.repositories.total,
      publishable: progress.repositories.publishable,
      incomplete: progress.repositories.incomplete,
      invalidIdentity: progress.repositories.invalidIdentity,
      invalidMetrics: progress.repositories.invalidMetrics,
      missingMarketplace: progress.repositories.missingMarketplace,
      updatedThisRun: progress.repositories.updatedThisRun,
      pendingThisRun: progress.repositories.pendingThisRun,
    },
    publication: progress.publication,
  }
}

function progressSnapshot(db: Database.Database, runId: string, log: (event: LogEvent) => void): TelegramSummary['progress'] {
  try {
    return telegramProgress(db, runId, true)
  } catch {
    log({ level: 'error', phase: 'notify', category: 'progress_snapshot_failed', runId })
    return undefined
  }
}

function summary(
  db: Database.Database,
  runId: string,
  counts?: CrawlSummary,
  buckets?: GitHubRateBuckets,
  progress?: TelegramSummary['progress'],
): TelegramSummary {
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
    ...(progress ? { progress } : {}),
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
    const progress = progressSnapshot(db, runId, log)
    await notifier.notifyFailure({ ...summary(db, runId, counts, buckets, progress), reason })
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
  progress: TelegramSummary['progress'],
  notifier: Notifier | undefined,
  now: () => Date,
  log: (event: LogEvent) => void,
): Promise<void> {
  if (!notifier) return
  try {
    await notifier.notifySuccess({
      ...summary(db, runId),
      ...(progress ? { progress } : {}),
      confirmedGitSha: sha,
    })
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
  const notificationProgress = options.notifier ? progressSnapshot(db, runId, log) : undefined
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
  await notifyPublishSuccess(db, runId, sha, notificationProgress, options.notifier, now, log)
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
  onPhase: (phase: 'discovery' | 'enrichment') => void,
): Promise<{ counts: CrawlSummary; size: number; report: RunReport }> {
  const crawlStartedAt = performance.now()
  const counts = await runCrawl(db, reader, runId, {
    ranges: options.ranges,
    now,
    signal: options.signal,
    started: options.started,
    log: options.log,
    onPhase,
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
    const progress = progressSnapshot(db, runId, log)
    await options.notifier.notifyDryRun(summary(db, runId, counts, options.rateBuckets?.(), progress))
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
  const log = options.log ?? ((event: LogEvent) => console.log(JSON.stringify(event)))
  const startedAt = now()
  let phase = 'startup'
  const samples: Array<{ at: number; pending: number }> = []
  const emitProgress = () => {
    try {
      const snapshot = inspectProgress(db)
      const at = Date.now()
      samples.push({ at, pending: snapshot.repositories.pendingThisRun ?? 0 })
      while (samples.length > 4) samples.shift()
      const first = samples[0]
      const last = samples[samples.length - 1]
      const elapsedMinutes = first && last ? (last.at - first.at) / 60_000 : 0
      const pendingRate = elapsedMinutes > 0 && first && last ? (first.pending - last.pending) / elapsedMinutes : 0
      const pending = snapshot.repositories.pendingThisRun ?? 0
      log({
        level: 'info',
        event: 'crawl.progress',
        phase,
        category: 'progress_snapshot',
        runId,
        message: `Crawl progress: ${phase}, ${snapshot.repositories.updatedThisRun ?? 0} updated, ${pending} pending`,
        elapsedMs: Math.max(0, now().getTime() - startedAt.getTime()),
        totalRepositories: snapshot.repositories.total,
        updatedRepositories: snapshot.repositories.updatedThisRun,
        pendingRepositories: pending,
        publishableRepositories: snapshot.repositories.publishable,
        incompleteRepositories: snapshot.repositories.incomplete,
        missingMarketplace: snapshot.repositories.missingMarketplace,
        errorCount: snapshot.errors?.count ?? 0,
        ...(options.rateBuckets ? { rateBuckets: options.rateBuckets() } : {}),
        ...(phase === 'enrichment' && pendingRate > 0 ? { etaMinutes: Math.ceil(pending / pendingRate) } : {}),
      })
    } catch {
      log({
        level: 'warn',
        event: 'crawl.progress_unavailable',
        phase,
        category: 'progress_snapshot_failed',
        runId,
        message: 'Could not read crawl progress snapshot',
      })
    }
  }
  log({ level: 'info', event: 'crawl.started', phase, category: 'started', runId, message: 'Crawl started' })
  const progressTimer = setInterval(emitProgress, 5 * 60_000)
  progressTimer.unref()
  try {
    const startError = await notifyCrawlStart(db, runId, options.notifier)
    let counts: CrawlSummary | undefined
    let startRecorded = false
    let prepared: { counts: CrawlSummary; size: number; report: RunReport }
    try {
      prepared = await crawlAndPrepare(
        db,
        reader,
        runId,
        { ...options, log },
        now,
        (completedCounts) => {
          counts = completedCounts
          if (startError) {
            logDelivery(db, runId, now, log, startError)
            startRecorded = true
          }
        },
        (nextPhase) => {
          phase = nextPhase
          log({
            level: 'info',
            event: 'crawl.phase_started',
            phase,
            category: 'phase_started',
            runId,
            message: `Started ${phase} phase`,
          })
        },
      )
      counts = prepared.counts
    } catch (error) {
      if (startError && !startRecorded) logDelivery(db, runId, now, log, startError)
      const failureCategory = category(error)
      log({
        level: 'error',
        event: 'crawl.failed',
        phase,
        category: failureCategory,
        runId,
        message: `Crawl failed during ${phase}: ${failureCategory}`,
      })
      await handleCrawlFailure(db, runId, error, counts, options, now, log)
      throw error
    }
    phase = 'finalize'
    log({
      level: 'info',
      event: 'crawl.completed',
      phase,
      category: 'completed',
      runId,
      message: `Crawl completed with ${prepared.size} repositories and ${prepared.report.warningCount} warnings`,
      size: prepared.size,
      report: prepared.report,
    })
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
  } finally {
    clearInterval(progressTimer)
  }
}
