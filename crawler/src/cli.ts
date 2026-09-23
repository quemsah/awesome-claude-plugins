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
import { executeCrawl, executePublish, type Notifier } from './service/execute.js'
import { crawlSchedule, ScheduleError } from './service/schedule.js'
import { openDatabase } from './storage/db.js'
import { CsvValidationError, importCsv, inspect } from './storage/importCsv.js'
import { listPublishable } from './storage/repositories.js'
import { getActiveRun, getPublicationLease, getSetting, recoverStoppedCrawl, setSetting } from './storage/runs.js'

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

export async function runCli(argv: string[], dependencies: CliDependencies = {}): Promise<void> {
  const [command, ...args] = argv
  const env = dependencies.env ?? process.env
  const output = dependencies.output ?? console.log
  const now = dependencies.now ?? (() => new Date())
  if (
    command !== 'seed' &&
    command !== 'seed-if-empty' &&
    command !== 'inspect' &&
    command !== 'crawl' &&
    command !== 'publish' &&
    command !== 'recover-crawl' &&
    command !== 'export'
  ) {
    throw new Error('Unknown command. Available: seed, seed-if-empty, inspect, crawl, publish, recover-crawl, export')
  }
  if (command === 'inspect' && args.length) throw new Error('Unknown inspect option')
  let force = false
  let dryRun = false
  let publishId: string | undefined
  let exportId: string | undefined
  let exportDirectory: string | undefined
  let recoverId: string | undefined
  let recoverPublication = false
  let historyLimit: number | undefined
  if (command === 'crawl') {
    const seen = new Set<string>()
    for (const option of args) {
      if (!['--force', '--dry-run'].includes(option) || seen.has(option)) throw new Error('Unknown or repeated crawl option')
      seen.add(option)
    }
    force = seen.has('--force')
    dryRun = seen.has('--dry-run')
  } else if (command === 'publish') {
    recoverPublication = args.length >= 4 && args[2] === '--recover' && args[3] === '--confirm-stopped'
    if (recoverPublication && args.length === 6 && args[4] === '--history-limit' && /^\d+$/.test(args[5])) {
      historyLimit = Number(args[5])
    }
    if (
      (!recoverPublication && args.length !== 2) ||
      (recoverPublication && args.length !== 4 && args.length !== 6) ||
      (args.length === 6 &&
        (historyLimit === undefined || !Number.isSafeInteger(historyLimit) || historyLimit < 257 || historyLimit > 2048)) ||
      args[0] !== '--run-id' ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(args[1])
    ) {
      throw new Error('publish requires --run-id <id> [--recover --confirm-stopped [--history-limit 257..2048]]')
    }
    publishId = args[1]
  } else if (command === 'recover-crawl') {
    if (args.length !== 3 || args[0] !== '--run-id' || !/^[A-Za-z0-9_-]{1,100}$/.test(args[1]) || args[2] !== '--confirm-stopped') {
      throw new Error('recover-crawl requires --run-id <id> --confirm-stopped')
    }
    recoverId = args[1]
  } else if (command === 'export') {
    if (args.length !== 4 || args[0] !== '--run-id' || !/^[A-Za-z0-9_-]{1,100}$/.test(args[1]) || args[2] !== '--output-dir') {
      throw new Error('export requires --run-id <id> --output-dir <absolute-path>')
    }
    exportId = args[1]
    exportDirectory = args[3]
  }
  const files = command === 'seed' || command === 'seed-if-empty' ? csvPaths(args) : undefined
  const config = command === 'crawl' || command === 'publish' ? parseConfig(command, env) : undefined
  const db = (dependencies.open ?? openDatabase)(config?.dbPath ?? env.DB_PATH ?? '')
  try {
    if (command === 'inspect') output(JSON.stringify(inspect(db)))
    else if (files) output(JSON.stringify(await importCsv(db, files, command as 'seed' | 'seed-if-empty')))
    else if (command === 'export' && exportId && exportDirectory) {
      exportDraftSnapshot(db, exportId, exportDirectory)
      output(JSON.stringify({ status: 'exported', runId: exportId, directory: exportDirectory }))
    } else if (command === 'recover-crawl' && recoverId) {
      recoverStoppedCrawl(db, recoverId, now().toISOString())
      output(JSON.stringify({ status: 'failed', runId: recoverId, reason: 'operator_recovery' }))
    } else if (command === 'crawl' && config) {
      let status: 'due' | 'not-due'
      try {
        status = crawlSchedule(db, now(), config.intervalHours, force)
      } catch (error) {
        if (error instanceof ScheduleError && (error.category === 'active_run' || error.category === 'publication_locked')) {
          await notifyBlockedSchedule(db, error.category, config, dependencies)
        }
        throw error
      }
      if (status === 'not-due') {
        output(JSON.stringify({ status }))
        return
      }
      const buckets: GitHubRateBuckets = {
        code_search: { requests: 0, waitMs: 0, lastRemaining: null },
        core: { requests: 0, waitMs: 0, lastRemaining: null },
      }
      let observed = false
      const rateLog: RateLog = (event) => {
        observed = true
        const bucket = buckets[event.bucket]
        if (event.request) bucket.requests++
        if (event.waitMs !== undefined) bucket.waitMs += event.waitMs
        if (event.remaining !== undefined) bucket.lastRemaining = event.remaining
      }
      const reader = dependencies.reader?.(config, rateLog) ?? new GitHubClient({ token: config.readToken ?? '', log: rateLog })
      const git = !dryRun && config.publishEnabled ? gitFor(config, dependencies) : undefined
      const notifier = notifierFor(config, dependencies)
      if (!notifier) output(JSON.stringify({ status: 'notifier-disabled' }))
      const runId = (dependencies.runId ?? randomUUID)()
      try {
        const result = await executeCrawl(db, reader, runId, {
          now,
          ranges: dependencies.ranges,
          dryRun: dryRun || !config.publishEnabled,
          git,
          notifier,
          rateBuckets: () => buckets,
        })
        output(JSON.stringify(result))
      } finally {
        if (observed) output(JSON.stringify({ phase: 'github_rate', runId, buckets }))
      }
    } else if (command === 'publish' && config && publishId) {
      const git = gitFor(config, dependencies)
      const notifier = notifierFor(config, dependencies)
      output(
        JSON.stringify(
          await executePublish(db, git, publishId, { now, notifier, writeEnabled: true, recover: recoverPublication, historyLimit }),
        ),
      )
    }
  } finally {
    db.close()
  }
}

export function formatCliError(error: unknown): string {
  const category =
    error instanceof ConfigurationError
      ? 'configuration'
      : error instanceof ScheduleError || error instanceof CrawlError || error instanceof PublicationError
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
