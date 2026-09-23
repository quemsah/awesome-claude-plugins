export type RuntimeConfig = {
  dbPath: string
  publishEnabled: boolean
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

function validBranch(branch: string): boolean {
  if (branch === '@' || branch.includes('@{')) return false
  return !branch
    .split('/')
    .some(
      (part) =>
        !part ||
        part.startsWith('.') ||
        part.endsWith('.') ||
        part.endsWith('.lock') ||
        part.includes('..') ||
        /[\\~^:?*[\]\s]/u.test(part),
    )
}

function repositoryParts(value: string | undefined): [string, string] | undefined {
  const parts = value?.split('/')
  if (
    parts?.length !== 2 ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(parts[0]) ||
    !/^[A-Za-z0-9._-]{1,100}$/.test(parts[1]) ||
    parts[1] === '.' ||
    parts[1] === '..'
  ) {
    return undefined
  }
  return [parts[0], parts[1]]
}

function publicationConfig(env: NodeJS.ProcessEnv, readToken?: string) {
  const publishToken = env.GITHUB_PUBLISH_TOKEN?.trim()
  const parts = repositoryParts(env.GITHUB_REPOSITORY)
  const branch = env.GITHUB_BRANCH
  if (!publishToken || (readToken && publishToken === readToken) || !parts || !branch || !validBranch(branch)) {
    throw new ConfigurationError()
  }
  return { publishToken, owner: parts[0], repo: parts[1], branch }
}

export function parseConfig(command: 'crawl' | 'publish', env: NodeJS.ProcessEnv): RuntimeConfig {
  if (!env.DB_PATH?.trim()) throw new ConfigurationError()
  const flag = env.PUBLISH_ENABLED ?? 'false'
  if (flag !== 'true' && flag !== 'false') throw new ConfigurationError()
  const publishEnabled = flag === 'true'
  const { botToken, chatId } = telegramCredentials(env, publishEnabled)
  if (command === 'publish' && !publishEnabled) throw new ConfigurationError()
  const readToken = env.GITHUB_READ_TOKEN?.trim()
  if (command === 'crawl' && !readToken) throw new ConfigurationError()
  const publisher = publishEnabled ? publicationConfig(env, readToken) : {}
  return {
    dbPath: env.DB_PATH,
    publishEnabled,
    readToken,
    ...publisher,
    botToken,
    chatId,
  }
}
