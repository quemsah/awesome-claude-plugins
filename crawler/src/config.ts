export type RuntimeConfig = {
  dbPath: string
  intervalHours: number
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

export function parseConfig(command: 'crawl' | 'publish', env: NodeJS.ProcessEnv): RuntimeConfig {
  if (!env.DB_PATH?.trim()) throw new ConfigurationError()
  const flag = env.PUBLISH_ENABLED ?? 'false'
  if (flag !== 'true' && flag !== 'false') throw new ConfigurationError()
  const interval = env.CRAWL_INTERVAL_HOURS ?? '72'
  if (!/^[1-9]\d*$/.test(interval) || !Number.isSafeInteger(Number(interval)) || Number(interval) > Number.MAX_SAFE_INTEGER / 3_600_000) {
    throw new ConfigurationError()
  }
  const publishEnabled = flag === 'true'
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim()
  const chatId = env.TELEGRAM_CHAT_ID?.trim()
  if (Boolean(botToken) !== Boolean(chatId) || (publishEnabled && (!botToken || !chatId))) throw new ConfigurationError()
  if (command === 'publish' && !publishEnabled) throw new ConfigurationError()
  const readToken = env.GITHUB_READ_TOKEN?.trim()
  if (command === 'crawl' && !readToken) throw new ConfigurationError()
  const publishToken = env.GITHUB_PUBLISH_TOKEN?.trim()
  let owner: string | undefined
  let repo: string | undefined
  let branch: string | undefined
  if (publishEnabled) {
    const parts = env.GITHUB_REPOSITORY?.split('/')
    if (
      !publishToken ||
      (readToken && publishToken === readToken) ||
      parts?.length !== 2 ||
      !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(parts[0]) ||
      !/^[A-Za-z0-9._-]{1,100}$/.test(parts[1]) ||
      parts[1] === '.' ||
      parts[1] === '..' ||
      !env.GITHUB_BRANCH ||
      env.GITHUB_BRANCH === '@' ||
      env.GITHUB_BRANCH.includes('@{') ||
      env.GITHUB_BRANCH.split('/').some(
        (part) =>
          !part ||
          part.startsWith('.') ||
          part.endsWith('.') ||
          part.endsWith('.lock') ||
          part.includes('..') ||
          /[\\~^:?*[\]\s]/u.test(part),
      )
    )
      throw new ConfigurationError()
    ;[owner, repo] = parts
    branch = env.GITHUB_BRANCH
  }
  return {
    dbPath: env.DB_PATH,
    intervalHours: Number(interval),
    publishEnabled,
    readToken,
    publishToken,
    owner,
    repo,
    branch,
    botToken,
    chatId,
  }
}
