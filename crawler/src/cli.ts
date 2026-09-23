import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
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
import { crawlSchedule, ScheduleError } from './service/schedule.js'
import { openDatabase } from './storage/db.js'
import { CsvValidationError, importCsv, inspect } from './storage/importCsv.js'
import { listPublishable } from './storage/repositories.js'
import { getActiveRun, getPublicationLease, getSetting, PublicationLeaseError, recoverStoppedCrawl, setSetting } from './storage/runs.js'

export type CliDependencies = {
  env?: NodeJS.ProcessEnv
  now?: () => Date
  runId?: () => string
  open?: (path: string) => Database.Database
  reader?: (config: RuntimeConfig, log: RateLog) => GitHubReader
  git?: (config: RuntimeConfig) => GitHubGit
  notifier?: (config: RuntimeConfig) => Notifier | undefined
  output?: (line: string) => void
  ranges?: readonly SizeRange[]
}

function csvPaths(args: string[]) {
  const paths = {
    reposPath: join('seed', 'c2-claude-plugins.csv'),
    statsPath: join('seed', 'c2-stats.csv'),
  }
  for (let i = 0; i < args.length; i += 2) {
    const option = args[i]
    if (!args[i + 1] || args[i + 1].startsWith('--') || !['--repos', '--stats'].includes(option)) {
      throw new Error(`Unknown or invalid seed option: ${option ?? '(missing value)'}`)
    }
    if (option === '--repos') paths.reposPath = args[i + 1]
    else paths.statsPath = args[i + 1]
  }
  return paths
}

function gitFor(config: RuntimeConfig, dependencies: CliDependencies): GitHubGit {
  return (
    dependencies.git?.(config) ??
    new GitHubGitClient({
      token: config.publishToken ?? '',
      owner: config.owner ?? '',
      repo: config.repo ?? '',
      branch: config.branch ?? '',
    })
  )
}

function notifierFor(config: RuntimeConfig, dependencies: CliDependencies): Notifier | undefined {
  return (
    dependencies.notifier?.(config) ??
    (config.botToken && config.chatId ? new TelegramNotifier({ botToken: config.botToken, chatId: config.chatId }) : undefined)
  )
}

type CliCommand = 'seed' | 'seed-if-empty' | 'inspect' | 'crawl' | 'publish' | 'recover-crawl' | 'export'
type ParsedOptions = {
  force: boolean
  dryRun: boolean
  publishId?: string
  exportId?: string
  exportDirectory?: string
  recoverId?: string
  recoverPublication: boolean
  historyLimit?: number
}

function parseCrawlOptions(args: string[]): Pick<ParsedOptions, 'force' | 'dryRun'> {
  const seen = new Set<string>()
  for (const option of args) {
    if (!['--force', '--dry-run'].includes(option) || seen.has(option)) throw new Error('Unknown or repeated crawl option')
    seen.add(option)
  }
  return { force: seen.has('--force'), dryRun: seen.has('--dry-run') }
}

function parsePublishOptions(args: string[]): Pick<ParsedOptions, 'publishId' | 'recoverPublication' | 'historyLimit'> {
  const recoverPublication = args.length >= 4 && args[2] === '--recover' && args[3] === '--confirm-stopped'
  const historyLimit =
    recoverPublication && args.length === 6 && args[4] === '--history-limit' && /^\d+$/.test(args[5]) ? Number(args[5]) : undefined
  if (
    (!recoverPublication && args.length !== 2) ||
    (recoverPublication && args.length !== 4 && args.length !== 6) ||
    (args.length === 6 &&
      (historyLimit === undefined || !Number.isSafeInteger(historyLimit) || historyLimit < 257 || historyLimit > 2048)) ||
    args[0] !== '--run-id' ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(args[1] ?? '')
  ) {
    throw new Error('publish requires --run-id <id> [--recover --confirm-stopped [--history-limit 257..2048]]')
  }
  return { publishId: args[1], recoverPublication, historyLimit }
}

function parseRunId(args: string[], command: 'recover-crawl' | 'export'): string {
  const expectedLength = command === 'export' ? 4 : 3
  const valid = args.length === expectedLength && args[0] === '--run-id' && /^[A-Za-z0-9_-]{1,100}$/.test(args[1] ?? '')
  if (command === 'recover-crawl' && valid && args[2] === '--confirm-stopped') return args[1]
  if (command === 'export' && valid && args[2] === '--output-dir' && args[3]) return args[1]
  throw new Error(`${command} requires --run-id <id> ${command === 'export' ? '--output-dir <absolute-path>' : '--confirm-stopped'}`)
}

function parseOptions(command: CliCommand, args: string[]): ParsedOptions {
  const defaults: ParsedOptions = { force: false, dryRun: false, recoverPublication: false }
  if (command === 'crawl') return { ...defaults, ...parseCrawlOptions(args) }
  if (command === 'publish') return { ...defaults, ...parsePublishOptions(args) }
  if (command === 'recover-crawl') return { ...defaults, recoverId: parseRunId(args, command) }
  if (command === 'export') {
    const exportId = parseRunId(args, command)
    return { ...defaults, exportId, exportDirectory: args[3] }
  }
  if (command === 'inspect' && args.length) throw new Error('Unknown inspect option')
  return defaults
}

async function notifyBlockedSchedule(
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

async function dueStatus(
  db: Database.Database,
  config: RuntimeConfig,
  dependencies: CliDependencies,
  force: boolean,
  now: () => Date,
): Promise<'due' | 'not-due'> {
  try {
    return crawlSchedule(db, now(), config.intervalHours, force)
  } catch (error) {
    if (error instanceof ScheduleError && (error.category === 'active_run' || error.category === 'publication_locked')) {
      await notifyBlockedSchedule(db, error.category, config, dependencies)
    }
    throw error
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

async function runDueCrawl(
  db: Database.Database,
  config: RuntimeConfig,
  dependencies: CliDependencies,
  options: Pick<ParsedOptions, 'dryRun'>,
  now: () => Date,
  output: (line: string) => void,
  rates: ReturnType<typeof rateTracker>,
): Promise<void> {
  const reader = dependencies.reader?.(config, rates.log) ?? new GitHubClient({ token: config.readToken ?? '', log: rates.log })
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
    })
    output(JSON.stringify(result))
  } finally {
    if (rates.observed()) output(JSON.stringify({ phase: 'github_rate', runId, buckets: rates.buckets }))
  }
}

async function runScheduledCrawl(
  db: Database.Database,
  config: RuntimeConfig,
  dependencies: CliDependencies,
  options: Pick<ParsedOptions, 'force' | 'dryRun'>,
  now: () => Date,
  output: (line: string) => void,
): Promise<void> {
  const status = await dueStatus(db, config, dependencies, options.force, now)
  if (status === 'not-due') {
    output(JSON.stringify({ status }))
    return
  }
  await runDueCrawl(db, config, dependencies, options, now, output, rateTracker())
}

async function runPublishCommand(
  db: Database.Database,
  config: RuntimeConfig,
  dependencies: CliDependencies,
  options: Pick<ParsedOptions, 'publishId' | 'recoverPublication' | 'historyLimit'>,
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
        historyLimit: options.historyLimit,
      }),
    ),
  )
}

export async function runCli(argv: string[], dependencies: CliDependencies = {}): Promise<void> {
  const [rawCommand, ...args] = argv
  const env = dependencies.env ?? process.env
  const output = dependencies.output ?? console.log
  const now = dependencies.now ?? (() => new Date())
  if (!rawCommand || !['seed', 'seed-if-empty', 'inspect', 'crawl', 'publish', 'recover-crawl', 'export'].includes(rawCommand)) {
    throw new Error('Unknown command. Available: seed, seed-if-empty, inspect, crawl, publish, recover-crawl, export')
  }
  const command = rawCommand as CliCommand
  const parsed = parseOptions(command, args)
  const files = command === 'seed' || command === 'seed-if-empty' ? csvPaths(args) : undefined
  const config = command === 'crawl' || command === 'publish' ? parseConfig(command, env) : undefined
  const db = (dependencies.open ?? openDatabase)(config?.dbPath ?? env.DB_PATH ?? '')
  try {
    if (command === 'inspect') output(JSON.stringify(inspect(db)))
    else if (files) output(JSON.stringify(await importCsv(db, files, command as 'seed' | 'seed-if-empty')))
    else if (command === 'export' && parsed.exportId && parsed.exportDirectory) {
      exportDraftSnapshot(db, parsed.exportId, parsed.exportDirectory)
      output(JSON.stringify({ status: 'exported', runId: parsed.exportId, directory: parsed.exportDirectory }))
    } else if (command === 'recover-crawl' && parsed.recoverId) {
      recoverStoppedCrawl(db, parsed.recoverId, now().toISOString())
      output(JSON.stringify({ status: 'failed', runId: parsed.recoverId, reason: 'operator_recovery' }))
    } else if (command === 'crawl' && config) {
      await runScheduledCrawl(db, config, dependencies, parsed, now, output)
    } else if (command === 'publish' && config) {
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
      : error instanceof ScheduleError ||
          error instanceof CrawlError ||
          error instanceof PublicationError ||
          error instanceof ActiveRunError ||
          error instanceof PublicationLeaseError
        ? error.category
        : error instanceof DraftExportError
          ? error.category
          : error instanceof CsvValidationError
            ? 'input_or_storage_error'
            : error instanceof Error && 'code' in error && error.code === 'ENOENT'
              ? 'missing_csv'
              : error instanceof Error && /^(Unknown|publish requires|recover-crawl requires|export requires)/.test(error.message)
                ? 'invalid_option'
                : error instanceof Error &&
                    /^(Unknown|publish requires|recover-crawl requires|export requires|Recovery requires|CSV|repos|stats|DB_PATH|Railway|Cannot verify|Partial seed|Unseeded|Inconsistent)/.test(
                      error.message,
                    )
                  ? 'input_or_storage_error'
                  : 'unexpected_error'
  return JSON.stringify({
    level: 'error',
    phase: 'cli',
    category,
    ...(error instanceof PublicationError && error.validation ? { validation: error.validation } : {}),
    ...(error instanceof CsvValidationError ? { validation: { table: error.table, row: error.row, column: error.column } } : {}),
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(formatCliError(error))
    process.exitCode = 1
  })
}
