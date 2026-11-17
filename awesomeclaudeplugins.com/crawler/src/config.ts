import { isValidGitBranch, parseGitHubRepository } from './github/identifiers.js'

export const DEFAULT_REPOSITORY_SEARCH_MAX_REQUESTS = 120
export const DEFAULT_ENRICHMENT_MAX_PENDING_CANDIDATES = 1000

export type RuntimeConfig = {
  dbPath: string
  publishEnabled: boolean
  repositorySearchEnabled: boolean
  repositorySearchMaxRequests: number
  reconcileExpiredGaps: boolean
  enrichmentMaxPendingCandidates: number
  readToken?: string
  publishToken?: string
  owner?: string
  repo?: string
  branch?: string
  botToken?: string
  chatId?: string
}

export class ConfigurationError extends Error {
  constructor() {
    super('Invalid or missing crawler configuration')
    this.name = 'ConfigurationError'
  }
}

function telegramCredentials(env: NodeJS.ProcessEnv, publishEnabled: boolean) {
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim()
  const chatId = env.TELEGRAM_CHAT_ID?.trim()
  if (Boolean(botToken) !== Boolean(chatId) || (publishEnabled && (!botToken || !chatId))) throw new ConfigurationError()
  return { botToken, chatId }
}

function publicationConfig(env: NodeJS.ProcessEnv, readToken?: string) {
  const publishToken = env.GITHUB_PUBLISH_TOKEN?.trim()
  const parts = parseGitHubRepository(env.GITHUB_REPOSITORY)
  const branch = env.GITHUB_BRANCH
  if (!publishToken || (readToken && publishToken === readToken) || !parts || !branch || !isValidGitBranch(branch)) {
    throw new ConfigurationError()
  }
  return { publishToken, owner: parts[0], repo: parts[1], branch }
}

function parsePositiveInteger(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value.trim() === '') return defaultValue
  const parsed = Number(value.trim())
  if (!Number.isInteger(parsed) || parsed <= 0) throw new ConfigurationError()
  return parsed
}

function parseBooleanFlag(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value.trim() === '') return defaultValue
  const flag = value.trim()
  if (flag !== 'true' && flag !== 'false') throw new ConfigurationError()
  return flag === 'true'
}

export function parseConfig(command: 'crawl' | 'publish', env: NodeJS.ProcessEnv): RuntimeConfig {
  if (!env.DB_PATH?.trim()) throw new ConfigurationError()
  const flag = env.PUBLISH_ENABLED ?? 'false'
  if (flag !== 'true' && flag !== 'false') throw new ConfigurationError()
  const publishEnabled = flag === 'true'
  const repoSearchFlag = env.REPOSITORY_SEARCH_ENABLED ?? 'false'
  if (repoSearchFlag !== 'true' && repoSearchFlag !== 'false') throw new ConfigurationError()
  const repositorySearchEnabled = repoSearchFlag === 'true'
  const repositorySearchMaxRequests = parsePositiveInteger(env.REPOSITORY_SEARCH_MAX_REQUESTS, DEFAULT_REPOSITORY_SEARCH_MAX_REQUESTS)
  const enrichmentMaxPendingCandidates = parsePositiveInteger(
    env.ENRICHMENT_MAX_PENDING_CANDIDATES,
    DEFAULT_ENRICHMENT_MAX_PENDING_CANDIDATES,
  )
  const reconcileExpiredGaps = parseBooleanFlag(env.RECONCILE_EXPIRED_GAPS, false)
  const { botToken, chatId } = telegramCredentials(env, publishEnabled)
  if (command === 'publish' && !publishEnabled) throw new ConfigurationError()
  const readToken = env.GITHUB_READ_TOKEN?.trim()
  if (command === 'crawl' && !readToken) throw new ConfigurationError()
  const publisher = publishEnabled ? publicationConfig(env, readToken) : {}
  return {
    dbPath: env.DB_PATH,
    publishEnabled,
    repositorySearchEnabled,
    repositorySearchMaxRequests,
    reconcileExpiredGaps,
    enrichmentMaxPendingCandidates,
    readToken,
    ...publisher,
    botToken,
    chatId,
  }
}
