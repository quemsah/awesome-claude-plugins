import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type Database from 'better-sqlite3'
import { ConfigurationError, parseConfig, type RuntimeConfig } from './config.js'
import { enrichPendingCandidates } from './crawl/enrich.js'
import { CrawlError } from './crawl/runCrawl.js'
import { GitHubClient, type GitHubReader } from './github/client.js'
import type { GitHubRateBuckets, RateLog } from './github/rateBudget.js'
import type { SizeRange } from './github/sizeRanges.js'
import type { LogEvent } from './logging.js'
import { TelegramNotificationError, TelegramNotifier } from './notify/telegram.js'
import { DraftExportError, exportDraftSnapshot } from './output/exportDraft.js'
import { type GitHubGit, GitHubGitClient } from './publish/githubGit.js'
import { PublicationError } from './publish/publishRun.js'
import { ActiveRunError, executeCrawl, executePublish, type Notifier } from './service/execute.js'
import { ShutdownError, throwIfShutdown } from './shutdown.js'
import { openDatabase, openReadOnlyDatabase } from './storage/db.js'
import { inspect } from './storage/inspect.js'
import { optimizeDatabase, runMaintenance } from './storage/maintenance.js'
import { inspectProgress } from './storage/progress.js'
import { listPublishable } from './storage/repositories.js'
import {
  beginRun,
  completeRun,
  failRun,
  getActiveRun,
  getPublicationLease,
  getSetting,
  heartbeatRun,
  listRunErrors,
  PublicationLeaseError,
  RunNotActiveError,
  recoverStaleRun,
  recoverStoppedCrawl,
  setSetting,
} from './storage/runs.js'

export type CliDependencies = {
  env?: NodeJS.ProcessEnv
  now?: () => Date
  runId?: () => string
  open?: (path: string) => Database.Database
  openReadonly?: (path: string) => Database.Database
  reader?: (config: RuntimeConfig, log: RateLog, signal?: AbortSignal) => GitHubReader
  git?: (config: RuntimeConfig, signal?: AbortSignal) => GitHubGit
  notifier?: (config: RuntimeConfig) => Notifier | undefined
  output?: (line: string) => void
  ranges?: readonly SizeRange[]
  signal?: AbortSignal
}

function gitFor(config: RuntimeConfig, dependencies: CliDependencies): GitHubGit {
  return (
    dependencies.git?.(config, dependencies.signal) ??
    new GitHubGitClient({
      token: config.publishToken ?? '',
      owner: config.owner ?? '',
      repo: config.repo ?? '',
      branch: config.branch ?? '',
      signal: dependencies.signal,
    })
  )
}

function notifierFor(config: RuntimeConfig, dependencies: CliDependencies): Notifier | undefined {
  return (
    dependencies.notifier?.(config) ??
    (config.botToken && config.chatId
      ? new TelegramNotifier({ botToken: config.botToken, chatId: config.chatId, signal: dependencies.signal })
      : undefined)
  )
}

type CliCommand = 'inspect' | 'inspect-progress' | 'crawl' | 'backfill-enrichment' | 'publish' | 'recover-crawl' | 'export' | 'maintenance'
type ParsedOptions = {
  dryRun: boolean
  reconcileExpiredGaps: boolean
  backfillLimit?: number
  publishId?: string
  exportId?: string
  exportDirectory?: string
  recoverId?: string
  recoverPublication: boolean
}

function parseCrawlOptions(args: string[]): Pick<ParsedOptions, 'dryRun' | 'reconcileExpiredGaps'> {
  const seen = new Set<string>()
  for (const option of args) {
    if (!['--dry-run', '--reconcile-expired-gaps'].includes(option) || seen.has(option)) throw new Error('Unknown or repeated crawl option')
    seen.add(option)
  }
  const dryRun = seen.has('--dry-run')
  const reconcileExpiredGaps = seen.has('--reconcile-expired-gaps')
  if (reconcileExpiredGaps && !dryRun) throw new Error('Gap reconciliation requires --dry-run')
  return { dryRun, reconcileExpiredGaps }
}

const MAX_BACKFILL_CANDIDATES = 3000

function parseBackfillOptions(args: string[]): Pick<ParsedOptions, 'backfillLimit'> {
  if (args.length !== 2 || args[0] !== '--limit' || !/^[1-9][0-9]*$/.test(args[1] ?? '')) {
    throw new Error('backfill-enrichment requires --limit <1..3000>')
  }
  const backfillLimit = Number(args[1])
  if (!Number.isSafeInteger(backfillLimit) || backfillLimit > MAX_BACKFILL_CANDIDATES) {
    throw new Error('backfill-enrichment requires --limit <1..3000>')
  }
  return { backfillLimit }
}

function parsePublishOptions(args: string[]): Pick<ParsedOptions, 'publishId' | 'recoverPublication'> {
  const recoverPublication = args.length === 4 && args[2] === '--recover' && args[3] === '--confirm-stopped'
  if ((args.length !== 2 && !recoverPublication) || args[0] !== '--run-id' || !/^[A-Za-z0-9_-]{1,100}$/.test(args[1] ?? '')) {
    throw new Error('publish requires --run-id <id> [--recover --confirm-stopped]')
  }
  return { publishId: args[1], recoverPublication }
}

function parseRunId(args: string[], command: 'recover-crawl' | 'export'): string {
  const expectedLength = command === 'export' ? 4 : 3
  const valid = args.length === expectedLength && args[0] === '--run-id' && /^[A-Za-z0-9_-]{1,100}$/.test(args[1] ?? '')
  if (command === 'recover-crawl' && valid && args[2] === '--confirm-stopped') return args[1]
  if (command === 'export' && valid && args[2] === '--output-dir' && args[3]) return args[1]
  throw new Error(`${command} requires --run-id <id> ${command === 'export' ? '--output-dir <absolute-path>' : '--confirm-stopped'}`)
}

function parseOptions(command: CliCommand, args: string[]): ParsedOptions {
  const defaults: ParsedOptions = { dryRun: false, reconcileExpiredGaps: false, recoverPublication: false }
  if (command === 'crawl') return { ...defaults, ...parseCrawlOptions(args) }
  if (command === 'backfill-enrichment') return { ...defaults, ...parseBackfillOptions(args) }
  if (command === 'publish') return { ...defaults, ...parsePublishOptions(args) }
  if (command === 'recover-crawl') return { ...defaults, recoverId: parseRunId(args, command) }
  if (command === 'export') {
    const exportId = parseRunId(args, command)
    return { ...defaults, exportId, exportDirectory: args[3] }
  }
  if ((command === 'inspect' || command === 'inspect-progress' || command === 'maintenance') && args.length)
    throw new Error(`Unknown ${command} option`)
  return defaults
}

function parseCommand(value: string | undefined): CliCommand {
  if (
    value &&
    ['inspect', 'inspect-progress', 'crawl', 'backfill-enrichment', 'publish', 'recover-crawl', 'export', 'maintenance'].includes(value)
  ) {
    return value as CliCommand
  }
  throw new Error(
    'Unknown command. Available: inspect, inspect-progress, crawl, backfill-enrichment, publish, recover-crawl, export, maintenance',
  )
}

async function notifyBlockedCrawl(
  db: Database.Database,
  category: 'active_run' | 'publication_locked',
  config: RuntimeConfig,
  dependencies: CliDependencies,
): Promise<void> {
  const runId = (category === 'active_run' ? getActiveRun(db)?.run_id : getPublicationLease(db)?.run_id) ?? null
  if (!runId) return
  const key = `schedule_alert_${category}_${runId}`
  if (getSetting(db, key) === 'sent') return
  try {
    const notifier = notifierFor(config, dependencies)
    if (!notifier) return
    await notifier.notifyFailure({
      runId,
      reason: category,
      catalogSize: listPublishable(db).length,
      newCount: 0,
      deletedCount: 0,
      skippedCount: 0,
      problematicRanges: [],
    })
  } catch (error) {
    if (error instanceof ShutdownError) throw error
    console.error(
      JSON.stringify({
        level: 'error',
        phase: 'notify',
        category: error instanceof TelegramNotificationError ? error.category : 'delivery_failed',
        runId,
      }),
    )
    return
  }
  try {
    setSetting(db, key, 'sent')
  } catch {
    console.error(JSON.stringify({ level: 'error', phase: 'notify', category: 'alert_checkpoint_failed', runId }))
  }
}

const STALE_RUN_THRESHOLD_MS = 2 * 60 * 60 * 1000

async function ensureCrawlAvailable(
  db: Database.Database,
  config: RuntimeConfig,
  dependencies: CliDependencies,
  now: () => Date,
): Promise<string | null> {
  if (getPublicationLease(db)) {
    await notifyBlockedCrawl(db, 'publication_locked', config, dependencies)
    throw new PublicationLeaseError('publication_locked')
  }

  const current = now()
  recoverStaleRun(db, new Date(current.getTime() - STALE_RUN_THRESHOLD_MS).toISOString(), current.toISOString())
  const active = getActiveRun(db)
  if (!active) return null

  await notifyBlockedCrawl(db, 'active_run', config, dependencies)
  return active.run_id
}

function updateGraphQLRateBucket(bucket: NonNullable<GitHubRateBuckets['graphql']>, event: Parameters<RateLog>[0]): void {
  if (event.cost !== undefined) {
    bucket.totalCost += event.cost
    bucket.lastCost = event.cost
  }
  if (event.limit !== undefined) bucket.lastLimit = event.limit
  if (event.used !== undefined) bucket.lastUsed = event.used
  if (event.resetAt !== undefined) bucket.resetAt = event.resetAt
  if (event.latencyMs !== undefined) {
    bucket.totalLatencyMs = (bucket.totalLatencyMs ?? 0) + event.latencyMs
    bucket.latencySamples = (bucket.latencySamples ?? 0) + 1
    bucket.lastLatencyMs = event.latencyMs
  }
}

function rateTracker(checkpoint?: (buckets: GitHubRateBuckets) => void): {
  buckets: GitHubRateBuckets
  log: RateLog
  observed: () => boolean
  checkpoint: () => void
} {
  const buckets: GitHubRateBuckets = {
    code_search: { requests: 0, waitMs: 0, lastRemaining: null },
    core: { requests: 0, waitMs: 0, lastRemaining: null },
    graphql: {
      requests: 0,
      waitMs: 0,
      lastRemaining: null,
      totalCost: 0,
      lastCost: null,
      lastLimit: null,
      lastUsed: null,
      resetAt: null,
      totalLatencyMs: 0,
      latencySamples: 0,
      lastLatencyMs: null,
    },
  }
  let hasObserved = false
  let requestsSinceCheckpoint = 0
  const persist = (force = false) => {
    if (!checkpoint || (!force && requestsSinceCheckpoint < 100)) return
    checkpoint(buckets)
    requestsSinceCheckpoint = 0
  }
  const rateLog: RateLog = (event) => {
    hasObserved = true
    if (event.bucket === 'repo_search') buckets.repo_search ??= { requests: 0, waitMs: 0, lastRemaining: null }
    const bucket = event.bucket === 'graphql' ? buckets.graphql : buckets[event.bucket]
    if (!bucket) return
    if (event.request) {
      bucket.requests++
      requestsSinceCheckpoint++
    }
    if (event.waitMs !== undefined) bucket.waitMs += event.waitMs
    if (event.remaining !== undefined) bucket.lastRemaining = event.remaining
    if (event.retryReason) {
      bucket.retries = (bucket.retries ?? 0) + 1
      bucket.retryWaitMs = (bucket.retryWaitMs ?? 0) + (event.retryWaitMs ?? 0)
      let reasons = bucket.retryReasons
      if (!reasons) {
        reasons = {}
        bucket.retryReasons = reasons
      }
      reasons[event.retryReason] = (reasons[event.retryReason] ?? 0) + 1
    }
    if (event.bucket === 'graphql' && buckets.graphql) updateGraphQLRateBucket(buckets.graphql, event)
    persist(event.retryReason !== undefined)
  }
  return { buckets, log: rateLog, observed: () => hasObserved, checkpoint: () => checkpoint?.(buckets) }
}

async function runCrawl(
  db: Database.Database,
  config: RuntimeConfig,
  dependencies: CliDependencies,
  options: Pick<ParsedOptions, 'dryRun' | 'reconcileExpiredGaps'>,
  runId: string,
  now: () => Date,
  output: (line: string) => void,
  rates: ReturnType<typeof rateTracker>,
): Promise<void> {
  const reader =
    dependencies.reader?.(config, rates.log, dependencies.signal) ??
    new GitHubClient({ token: config.readToken ?? '', log: rates.log, signal: dependencies.signal })
  const git = !options.dryRun && config.publishEnabled ? gitFor(config, dependencies) : undefined
  const notifier = notifierFor(config, dependencies)
  const log = (event: LogEvent) =>
    output(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        message: event.message ?? `${event.phase}: ${event.category}`,
        ...event,
      }),
    )
  if (!notifier) output(JSON.stringify({ status: 'notifier-disabled' }))
  try {
    const result = await executeCrawl(db, reader, runId, {
      now,
      ranges: dependencies.ranges,
      dryRun: options.dryRun || !config.publishEnabled,
      git,
      notifier,
      rateBuckets: () => rates.buckets,
      signal: dependencies.signal,
      started: true,
      repositorySearchEnabled: config.repositorySearchEnabled,
      repositorySearchMaxRequests: config.repositorySearchMaxRequests,
      reconcileExpiredGaps: options.reconcileExpiredGaps || config.reconcileExpiredGaps,
      enrichmentMaxPendingCandidates: config.enrichmentMaxPendingCandidates,
      log,
    })
    output(JSON.stringify(result))
  } finally {
    rates.checkpoint()
    if (rates.observed())
      log({
        level: 'info',
        event: 'github.rate_summary',
        phase: 'github_rate',
        category: 'rate_summary',
        runId,
        message: 'GitHub API rate-limit summary',
        buckets: rates.buckets,
      })
  }
}

async function runCrawlCommand(
  db: Database.Database,
  config: RuntimeConfig,
  dependencies: CliDependencies,
  options: Pick<ParsedOptions, 'dryRun' | 'reconcileExpiredGaps'>,
  now: () => Date,
  output: (line: string) => void,
): Promise<void> {
  const reconcileExpiredGaps = options.reconcileExpiredGaps || config.reconcileExpiredGaps
  if (reconcileExpiredGaps && !config.repositorySearchEnabled) throw new Error('Gap reconciliation requires REPOSITORY_SEARCH_ENABLED=true')
  const activeRunId = await ensureCrawlAvailable(db, config, dependencies, now)
  if (activeRunId) {
    output(JSON.stringify({ status: 'skipped', reason: 'active_run', runId: activeRunId }))
    return
  }
  runMaintenance(db, now())
  const runId = (dependencies.runId ?? randomUUID)()
  try {
    beginRun(db, runId, now().toISOString())
  } catch (error) {
    if (error instanceof PublicationLeaseError) {
      await notifyBlockedCrawl(db, 'publication_locked', config, dependencies)
      throw error
    }
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const active = getActiveRun(db)
      if (active) {
        await notifyBlockedCrawl(db, 'active_run', config, dependencies)
        output(JSON.stringify({ status: 'skipped', reason: 'active_run', runId: active.run_id }))
        return
      }
    }
    throw error
  }

  const rates = rateTracker((buckets) => {
    try {
      setSetting(db, `run_rate_metrics_${runId}`, JSON.stringify(buckets))
    } catch {
      console.error(JSON.stringify({ level: 'error', phase: 'github_rate', category: 'rate_checkpoint_failed', runId }))
    }
  })
  try {
    rates.checkpoint()
    await runCrawl(db, config, dependencies, { ...options, reconcileExpiredGaps }, runId, now, output, rates)
  } catch (error) {
    try {
      failRun(db, runId, now().toISOString(), 'startup_failed')
    } catch {}
    throw error
  } finally {
    try {
      optimizeDatabase(db)
    } catch {
      console.error(JSON.stringify({ level: 'error', phase: 'maintenance', category: 'optimize_failed' }))
    }
  }
}

/**
 * Manually drain only pending repositories. No Discovery, health checks, draft creation,
 * publication or Telegram notifications. Shares the persistent cursor and run lease.
 */
async function runBackfillCommand(
  db: Database.Database,
  config: RuntimeConfig,
  dependencies: CliDependencies,
  limit: number,
  now: () => Date,
  output: (line: string) => void,
): Promise<void> {
  // Never recover or replace an active crawl: both modes mutate the same database.
  if (getPublicationLease(db)) throw new PublicationLeaseError('publication_locked')
  const active = getActiveRun(db)
  if (active) {
    output(JSON.stringify({ status: 'skipped', reason: 'active_run', runId: active.run_id }))
    return
  }

  const runId = (dependencies.runId ?? randomUUID)()
  try {
    beginRun(db, runId, now().toISOString())
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const concurrent = getActiveRun(db)
      if (concurrent) {
        output(JSON.stringify({ status: 'skipped', reason: 'active_run', runId: concurrent.run_id }))
        return
      }
    }
    throw error
  }

  const rates = rateTracker((buckets) => {
    try {
      setSetting(db, `run_rate_metrics_${runId}`, JSON.stringify(buckets))
    } catch {
      console.error(JSON.stringify({ level: 'error', phase: 'github_rate', category: 'rate_checkpoint_failed', runId }))
    }
  })
  const log = (event: LogEvent) =>
    output(JSON.stringify({ timestamp: new Date().toISOString(), message: event.message ?? `${event.phase}: ${event.category}`, ...event }))
  try {
    rates.checkpoint()
    const reader =
      dependencies.reader?.(config, rates.log, dependencies.signal) ??
      new GitHubClient({ token: config.readToken ?? '', log: rates.log, signal: dependencies.signal })
    const heartbeat = () => {
      throwIfShutdown(dependencies.signal)
      if (!heartbeatRun(db, runId, now().toISOString())) throw new RunNotActiveError(runId)
    }
    const enrichment = await enrichPendingCandidates(db, reader, runId, heartbeat, () => now().toISOString(), log, limit)
    heartbeat()
    if (!completeRun(db, runId, now().toISOString(), listRunErrors(db, runId).length)) throw new RunNotActiveError(runId)
    log({
      level: 'info',
      event: 'crawl.backfill_completed',
      phase: 'enrichment',
      category: 'backfill_completed',
      runId,
      message: `Pending-only backfill completed: ${enrichment.pendingQueueBefore} -> ${enrichment.pendingQueueAfter}, ${enrichment.pendingQueueSelected} selected`,
      ...enrichment,
    })
    output(JSON.stringify({ status: 'completed', command: 'backfill-enrichment', runId, limit, enrichment, rateBuckets: rates.buckets }))
  } catch (error) {
    try {
      failRun(db, runId, now().toISOString(), error instanceof ShutdownError ? 'terminated' : 'backfill_failed')
    } catch {
      // Never replace the original failure with a secondary status-write failure.
    }
    throw error
  } finally {
    rates.checkpoint()
    if (rates.observed())
      log({
        level: 'info',
        event: 'github.rate_summary',
        phase: 'github_rate',
        category: 'rate_summary',
        runId,
        message: 'GitHub API rate-limit summary',
        buckets: rates.buckets,
      })
  }
}

async function runPublishCommand(
  db: Database.Database,
  config: RuntimeConfig,
  dependencies: CliDependencies,
  options: Pick<ParsedOptions, 'publishId' | 'recoverPublication'>,
  now: () => Date,
  output: (line: string) => void,
): Promise<void> {
  if (!options.publishId) return
  const git = gitFor(config, dependencies)
  const notifier = notifierFor(config, dependencies)
  output(
    JSON.stringify(
      await executePublish(db, git, options.publishId, {
        now,
        notifier,
        writeEnabled: true,
        recover: options.recoverPublication,
        signal: dependencies.signal,
      }),
    ),
  )
}

async function runLocalCommand(
  db: Database.Database,
  command: CliCommand,
  parsed: ParsedOptions,
  now: () => Date,
  output: (line: string) => void,
): Promise<boolean> {
  if (command === 'inspect') {
    output(JSON.stringify(inspect(db, now())))
    return true
  }
  if (command === 'inspect-progress') {
    output(JSON.stringify(inspectProgress(db)))
    return true
  }
  if (command === 'maintenance') {
    const result = runMaintenance(db, now())
    try {
      optimizeDatabase(db)
    } catch {
      console.error(JSON.stringify({ level: 'error', phase: 'maintenance', category: 'optimize_failed' }))
    }
    output(JSON.stringify({ status: 'maintained', ...result }))
    return true
  }
  if (command === 'export' && parsed.exportId && parsed.exportDirectory) {
    exportDraftSnapshot(db, parsed.exportId, parsed.exportDirectory)
    output(JSON.stringify({ status: 'exported', runId: parsed.exportId, directory: parsed.exportDirectory }))
    return true
  }
  if (command === 'recover-crawl' && parsed.recoverId) {
    recoverStoppedCrawl(db, parsed.recoverId, now().toISOString())
    output(JSON.stringify({ status: 'failed', runId: parsed.recoverId, reason: 'operator_recovery' }))
    return true
  }
  return false
}

export async function runCli(argv: string[], dependencies: CliDependencies = {}): Promise<void> {
  const [rawCommand, ...args] = argv
  const env = dependencies.env ?? process.env
  const output = dependencies.output ?? console.log
  const now = dependencies.now ?? (() => new Date())
  const command = parseCommand(rawCommand)
  const parsed = parseOptions(command, args)
  const config = command === 'crawl' || command === 'publish' || command === 'backfill-enrichment' ? parseConfig(command, env) : undefined
  const open = command === 'inspect-progress' ? (dependencies.openReadonly ?? openReadOnlyDatabase) : (dependencies.open ?? openDatabase)
  const db = open(config?.dbPath ?? env.DB_PATH ?? '')
  try {
    const handled = await runLocalCommand(db, command, parsed, now, output)
    if (!handled && command === 'crawl' && config) {
      await runCrawlCommand(db, config, dependencies, parsed, now, output)
    } else if (!handled && command === 'backfill-enrichment' && config && parsed.backfillLimit) {
      await runBackfillCommand(db, config, dependencies, parsed.backfillLimit, now, output)
    } else if (!handled && command === 'publish' && config) {
      await runPublishCommand(db, config, dependencies, parsed, now, output)
    }
  } finally {
    db.close()
  }
}

export function formatCliError(error: unknown): string {
  const category =
    error instanceof ConfigurationError
      ? 'configuration'
      : error instanceof CrawlError ||
          error instanceof PublicationError ||
          error instanceof ActiveRunError ||
          error instanceof PublicationLeaseError
        ? error.category
        : error instanceof DraftExportError
          ? error.category
          : error instanceof Error &&
              /^(Unknown|backfill-enrichment requires|publish requires|recover-crawl requires|export requires)/.test(error.message)
            ? 'invalid_option'
            : error instanceof Error && /^(Recovery requires|DB_PATH|Railway|Cannot verify|Inconsistent)/.test(error.message)
              ? 'input_or_storage_error'
              : 'unexpected_error'
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    message: `Crawler command failed: ${category}`,
    event: 'cli.failed',
    level: 'error',
    phase: 'cli',
    category,
    ...(error instanceof PublicationError && error.validation ? { validation: error.validation } : {}),
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const shutdown = new AbortController()
  const requestShutdown = () => shutdown.abort()
  process.once('SIGTERM', requestShutdown)
  process.once('SIGINT', requestShutdown)

  runCli(process.argv.slice(2), { signal: shutdown.signal })
    .catch((error: unknown) => {
      if (
        error instanceof ShutdownError ||
        (error instanceof CrawlError && error.category === 'terminated') ||
        (error instanceof PublicationError && error.category === 'terminated')
      ) {
        console.log(JSON.stringify({ status: 'terminated' }))
        return
      }
      console.error(formatCliError(error))
      process.exitCode = 1
    })
    .finally(() => {
      process.removeListener('SIGTERM', requestShutdown)
      process.removeListener('SIGINT', requestShutdown)
    })
}
