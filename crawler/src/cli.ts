import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type Database from 'better-sqlite3'
import { ConfigurationError, parseConfig, type RuntimeConfig } from './config.js'
import { CrawlError } from './crawl/runCrawl.js'
import { GitHubClient, type GitHubReader } from './github/client.js'
import type { GitHubRateBuckets, RateLog } from './github/rateBudget.js'
import type { SizeRange } from './github/sizeRanges.js'
import { TelegramNotificationError, TelegramNotifier } from './notify/telegram.js'
import { DraftExportError, exportDraftSnapshot } from './output/exportDraft.js'
import { type GitHubGit, GitHubGitClient } from './publish/githubGit.js'
import { PublicationError } from './publish/publishRun.js'
import { ActiveRunError, executeCrawl, executePublish, type Notifier } from './service/execute.js'
import { ShutdownError } from './shutdown.js'
import { openDatabase } from './storage/db.js'
import { inspect } from './storage/inspect.js'
import { optimizeDatabase, runMaintenance } from './storage/maintenance.js'
import { listPublishable } from './storage/repositories.js'
import { getActiveRun, getPublicationLease, getSetting, PublicationLeaseError, recoverStoppedCrawl, setSetting } from './storage/runs.js'

export type CliDependencies = {
  env?: NodeJS.ProcessEnv
  now?: () => Date
  runId?: () => string
  open?: (path: string) => Database.Database
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

type CliCommand = 'inspect' | 'crawl' | 'publish' | 'recover-crawl' | 'export' | 'maintenance'
type ParsedOptions = {
  dryRun: boolean
  publishId?: string
  exportId?: string
  exportDirectory?: string
  recoverId?: string
  recoverPublication: boolean
}

function parseCrawlOptions(args: string[]): Pick<ParsedOptions, 'dryRun'> {
  const seen = new Set<string>()
  for (const option of args) {
    if (option !== '--dry-run' || seen.has(option)) throw new Error('Unknown or repeated crawl option')
    seen.add(option)
  }
  return { dryRun: seen.has('--dry-run') }
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
  const defaults: ParsedOptions = { dryRun: false, recoverPublication: false }
  if (command === 'crawl') return { ...defaults, ...parseCrawlOptions(args) }
  if (command === 'publish') return { ...defaults, ...parsePublishOptions(args) }
  if (command === 'recover-crawl') return { ...defaults, recoverId: parseRunId(args, command) }
  if (command === 'export') {
    const exportId = parseRunId(args, command)
    return { ...defaults, exportId, exportDirectory: args[3] }
  }
  if ((command === 'inspect' || command === 'maintenance') && args.length) throw new Error(`Unknown ${command} option`)
  return defaults
}

function parseCommand(value: string | undefined): CliCommand {
  if (value && ['inspect', 'crawl', 'publish', 'recover-crawl', 'export', 'maintenance'].includes(value)) {
    return value as CliCommand
  }
  throw new Error('Unknown command. Available: inspect, crawl, publish, recover-crawl, export, maintenance')
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

async function ensureCrawlAvailable(db: Database.Database, config: RuntimeConfig, dependencies: CliDependencies): Promise<void> {
  const blocked = getActiveRun(db) ? 'active_run' : getPublicationLease(db) ? 'publication_locked' : null
  if (blocked) {
    await notifyBlockedCrawl(db, blocked, config, dependencies)
    throw new PublicationLeaseError(blocked)
  }
}

function rateTracker(): { buckets: GitHubRateBuckets; log: RateLog; observed: () => boolean } {
  const buckets: GitHubRateBuckets = {
    code_search: { requests: 0, waitMs: 0, lastRemaining: null },
    core: { requests: 0, waitMs: 0, lastRemaining: null },
  }
  let hasObserved = false
  const rateLog: RateLog = (event) => {
    hasObserved = true
    const bucket = buckets[event.bucket]
    if (event.request) bucket.requests++
    if (event.waitMs !== undefined) bucket.waitMs += event.waitMs
    if (event.remaining !== undefined) bucket.lastRemaining = event.remaining
  }
  return { buckets, log: rateLog, observed: () => hasObserved }
}

async function runCrawl(
  db: Database.Database,
  config: RuntimeConfig,
  dependencies: CliDependencies,
  options: Pick<ParsedOptions, 'dryRun'>,
  now: () => Date,
  output: (line: string) => void,
  rates: ReturnType<typeof rateTracker>,
): Promise<void> {
  const reader =
    dependencies.reader?.(config, rates.log, dependencies.signal) ??
    new GitHubClient({ token: config.readToken ?? '', log: rates.log, signal: dependencies.signal })
  const git = !options.dryRun && config.publishEnabled ? gitFor(config, dependencies) : undefined
  const notifier = notifierFor(config, dependencies)
  if (!notifier) output(JSON.stringify({ status: 'notifier-disabled' }))
  const runId = (dependencies.runId ?? randomUUID)()
  try {
    const result = await executeCrawl(db, reader, runId, {
      now,
      ranges: dependencies.ranges,
      dryRun: options.dryRun || !config.publishEnabled,
      git,
      notifier,
      rateBuckets: () => rates.buckets,
      signal: dependencies.signal,
    })
    output(JSON.stringify(result))
  } finally {
    if (rates.observed()) output(JSON.stringify({ phase: 'github_rate', runId, buckets: rates.buckets }))
  }
}

async function runCrawlCommand(
  db: Database.Database,
  config: RuntimeConfig,
  dependencies: CliDependencies,
  options: Pick<ParsedOptions, 'dryRun'>,
  now: () => Date,
  output: (line: string) => void,
): Promise<void> {
  await ensureCrawlAvailable(db, config, dependencies)
  runMaintenance(db, now())
  try {
    await runCrawl(db, config, dependencies, options, now, output, rateTracker())
  } finally {
    try {
      optimizeDatabase(db)
    } catch {
      console.error(JSON.stringify({ level: 'error', phase: 'maintenance', category: 'optimize_failed' }))
    }
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
    output(JSON.stringify(inspect(db)))
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
  const config = command === 'crawl' || command === 'publish' ? parseConfig(command, env) : undefined
  const db = (dependencies.open ?? openDatabase)(config?.dbPath ?? env.DB_PATH ?? '')
  try {
    const handled = await runLocalCommand(db, command, parsed, now, output)
    if (!handled && command === 'crawl' && config) {
      await runCrawlCommand(db, config, dependencies, parsed, now, output)
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
          : error instanceof Error && /^(Unknown|publish requires|recover-crawl requires|export requires)/.test(error.message)
            ? 'invalid_option'
            : error instanceof Error && /^(Recovery requires|DB_PATH|Railway|Cannot verify|Inconsistent)/.test(error.message)
              ? 'input_or_storage_error'
              : 'unexpected_error'
  return JSON.stringify({
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
