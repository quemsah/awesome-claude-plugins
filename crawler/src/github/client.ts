import { type Clock, RateBudget, type RateLog, type RateResource } from './rateBudget.js'

export type SearchPage = {
  items: Array<{ repository: { html_url: string; description: string | null } }>
  total_count: number
  incomplete_results: boolean
}

export type GitHubRepo = {
  html_url: string
  name: string
  description: string | null
  stargazers_count: number
  forks_count: number
  subscribers_count: number
  pushed_at: string
  owner: { login: string; html_url: string }
}

export type Marketplace = { plugins: unknown[] }

export type RepoResult<T> =
  | { kind: 'found'; data: T }
  | { kind: 'not-found' }
  | { kind: 'temporary-error'; status: number | null; reason: string }

export interface GitHubReader {
  searchCode(query: string, page: number): Promise<SearchPage>
  getRepository(owner: string, repo: string): Promise<RepoResult<GitHubRepo>>
  getMarketplace(owner: string, repo: string): Promise<RepoResult<Marketplace>>
}

export class GitHubFatalError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message)
    this.name = 'GitHubFatalError'
  }
}

export class GitHubTemporaryError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message)
    this.name = 'GitHubTemporaryError'
  }
}

type Options = {
  token: string
  fetch?: typeof fetch
  clock?: Clock
  random?: () => number
  log?: RateLog
}

const defaultClock: Clock = {
  now: Date.now,
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function description(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function parseSearch(value: unknown): SearchPage {
  if (
    !record(value) ||
    !count(value.total_count) ||
    typeof value.incomplete_results !== 'boolean' ||
    !Array.isArray(value.items) ||
    !value.items.every(
      (item: unknown) =>
        record(item) && record(item.repository) && nonempty(item.repository.html_url) && description(item.repository.description),
    )
  ) {
    throw new Error('Invalid code search response')
  }
  return value as SearchPage
}

function parseRepository(value: unknown): GitHubRepo {
  if (
    !record(value) ||
    !nonempty(value.html_url) ||
    !nonempty(value.name) ||
    !description(value.description) ||
    !count(value.stargazers_count) ||
    !count(value.forks_count) ||
    !count(value.subscribers_count) ||
    !nonempty(value.pushed_at) ||
    !record(value.owner) ||
    !nonempty(value.owner.login) ||
    !nonempty(value.owner.html_url)
  ) {
    throw new Error('Invalid repository response')
  }
  return value as GitHubRepo
}

function parseMarketplace(value: unknown): Marketplace {
  if (!record(value) || value.encoding !== 'base64' || typeof value.content !== 'string') {
    throw new Error('Invalid marketplace content response')
  }
  const encoded = value.content.replace(/\s/g, '')
  if (!encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error('Invalid marketplace base64')
  }
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.toString('base64') !== encoded) throw new Error('Invalid marketplace base64')

  const decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  if (!record(decoded) || !Array.isArray(decoded.plugins)) throw new Error('Invalid marketplace plugins')
  return { plugins: decoded.plugins }
}

function retryAfter(headers: Headers, now: number): number | null {
  const raw = headers.get('retry-after')
  if (raw === null) return null
  const seconds = Number(raw)
  if (raw.trim() !== '' && Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000)
  const date = Date.parse(raw)
  return Number.isNaN(date) ? null : Math.max(0, date - now)
}

export class GitHubClient implements GitHubReader {
  private readonly budget: RateBudget
  private readonly clock: Clock
  private readonly transport: typeof fetch
  private readonly random: () => number
  private readonly token: string
  private pending: Promise<void> = Promise.resolve()

  constructor(options: Options) {
    if (!options.token.trim()) throw new GitHubFatalError('GitHub token is required', null)
    this.token = options.token
    this.clock = options.clock ?? defaultClock
    this.transport = options.fetch ?? globalThis.fetch
    this.random = options.random ?? Math.random
    this.budget = new RateBudget(this.clock, options.log)
  }

  async searchCode(query: string, page: number): Promise<SearchPage> {
    if (!Number.isInteger(page) || page < 1 || page > 10) throw new GitHubFatalError('Code search page must be 1..10', null)
    const params = new URLSearchParams({ q: query, per_page: '100', page: String(page) })
    const result = await this.request('code_search', `/search/code?${params}`, parseSearch)
    if (result.kind !== 'found')
      throw new GitHubTemporaryError(
        result.kind === 'not-found' ? 'Code search not found' : result.reason,
        result.kind === 'not-found' ? 404 : result.status,
      )
    return result.data
  }

  getRepository(owner: string, repo: string): Promise<RepoResult<GitHubRepo>> {
    return this.request('core', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, parseRepository)
  }

  getMarketplace(owner: string, repo: string): Promise<RepoResult<Marketplace>> {
    return this.request(
      'core',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/.claude-plugin/marketplace.json`,
      parseMarketplace,
    )
  }

  private request<T>(bucket: RateResource, path: string, parse: (value: unknown) => T): Promise<RepoResult<T>> {
    const run = this.pending.then(() => this.perform(bucket, path, parse))
    this.pending = run.then(
      () => {},
      () => {},
    )
    return run
  }

  private async perform<T>(bucket: RateResource, path: string, parse: (value: unknown) => T): Promise<RepoResult<T>> {
    let secondaryCount = 0
    for (let attempt = 0; attempt < 4; attempt++) {
      await this.budget.acquire(bucket)
      let response: Response
      try {
        response = await this.transport(`https://api.github.com${path}`, {
          signal: AbortSignal.timeout(30_000),
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        })
      } catch {
        if (attempt === 3) return { kind: 'temporary-error', status: null, reason: 'GitHub network error' }
        this.budget.defer(bucket, this.transientDelay(attempt))
        continue
      }

      this.budget.observe(bucket, response.headers)
      const delay = retryAfter(response.headers, this.clock.now())
      if (delay !== null) this.budget.defer(bucket, delay)
      const status = response.status
      if (status === 401 || status === 422) throw new GitHubFatalError(`GitHub request rejected (${status})`, status)
      if (status === 404) return { kind: 'not-found' }

      const remaining = response.headers.get('x-ratelimit-remaining')
      if (status === 403 || status === 429) {
        let secondary = status === 429 || (status === 403 && remaining !== '0' && delay !== null)
        if (status === 403 && remaining !== '0' && delay === null) {
          const body = await response.text().catch(() => '')
          if (/secondary rate limit|abuse detection/i.test(body)) secondary = true
          else throw new GitHubFatalError('GitHub access forbidden (403)', status)
        }
        if (secondary) secondaryCount++
        this.budget.defer(
          bucket,
          Math.max(delay ?? 0, secondary ? 60_000 * 2 ** (secondaryCount - 1) + Math.floor(this.random() * 1_000) : 0),
        )
        if (attempt === 3) return { kind: 'temporary-error', status, reason: 'GitHub rate limited' }
        continue
      }

      if (status >= 500 && status <= 599) {
        if (attempt === 3) return { kind: 'temporary-error', status, reason: 'GitHub server error' }
        this.budget.defer(bucket, Math.max(delay ?? 0, this.transientDelay(attempt)))
        continue
      }
      if (!response.ok) return { kind: 'temporary-error', status, reason: 'GitHub HTTP error' }

      try {
        return { kind: 'found', data: parse((await response.json()) as unknown) }
      } catch {
        if (attempt === 3) return { kind: 'temporary-error', status, reason: 'Invalid GitHub response' }
        this.budget.defer(bucket, this.transientDelay(attempt))
      }
    }
    return { kind: 'temporary-error', status: null, reason: 'GitHub retry limit exceeded' }
  }

  private transientDelay(attempt: number): number {
    return 1_000 * 2 ** attempt + Math.floor(this.random() * 250)
  }
}
