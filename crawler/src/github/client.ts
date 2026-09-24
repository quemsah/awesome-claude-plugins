import { parseMarketplaceManifest } from '@awesome-claude-plugins/marketplace-contract'
import type { components, operations } from '@octokit/openapi-types'
import { throwIfShutdown } from '../shutdown.js'
import { type Clock, RateBudget, type RateLog, type RateResource, systemClock } from './rateBudget.js'

type SearchCodeResponse = operations['search/code']['responses'][200]['content']['application/json']
type SearchCodeRepository = SearchCodeResponse['items'][number]['repository']

export type SearchPage = Pick<SearchCodeResponse, 'total_count' | 'incomplete_results'> & {
  items: Array<{
    repository: Pick<SearchCodeRepository, 'html_url' | 'description'> & { private?: SearchCodeRepository['private'] }
  }>
}

type RepositoryResponse = components['schemas']['full-repository']

export type GitHubRepo = Pick<
  RepositoryResponse,
  'html_url' | 'name' | 'description' | 'stargazers_count' | 'forks_count' | 'subscribers_count' | 'pushed_at'
> & {
  owner: Pick<RepositoryResponse['owner'], 'login' | 'html_url'>
  pushed_at: Extract<RepositoryResponse['pushed_at'], string>
  private?: RepositoryResponse['private']
}

export type Marketplace = { plugins: unknown[]; etag: string | null }

export type RepoResult<T> =
  | { kind: 'found'; data: T }
  | { kind: 'not-found'; retryCount?: number }
  | { kind: 'temporary-error'; status: number | null; reason: string; retryCount: number }

export type ConditionalRepoResult<T> = RepoResult<T> | { kind: 'not-modified'; retryCount: number }

type ResponseAction<T> =
  | { kind: 'retry'; secondaryCount: number }
  | { kind: 'result'; result: ConditionalRepoResult<T> }

export interface GitHubReader {
  searchCode(query: string, page: number): Promise<SearchPage>
  getRepository(owner: string, repo: string): Promise<RepoResult<GitHubRepo>>
  getMarketplace(owner: string, repo: string, etag?: string): Promise<ConditionalRepoResult<Marketplace>>
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
    readonly retryCount = 0,
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
  signal?: AbortSignal
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
        record(item) &&
        record(item.repository) &&
        nonempty(item.repository.html_url) &&
        description(item.repository.description) &&
        (item.repository.private === undefined || typeof item.repository.private === 'boolean'),
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
    typeof value.private !== 'boolean' ||
    !record(value.owner) ||
    !nonempty(value.owner.login) ||
    !nonempty(value.owner.html_url)
  ) {
    throw new Error('Invalid repository response')
  }
  return value as GitHubRepo
}

function safeEntityTag(value: string | null): string | null {
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= 512 && !/[\r\n]/.test(trimmed) ? trimmed : null
}

function parseMarketplace(value: unknown, response: Response): Marketplace {
  return { ...parseMarketplaceManifest(value), etag: safeEntityTag(response.headers.get('etag')) }
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
  private readonly signal?: AbortSignal
  private pending: Promise<void> = Promise.resolve()

  constructor(options: Options) {
    if (!options.token.trim()) throw new GitHubFatalError('GitHub token is required', null)
    this.token = options.token
    this.clock = options.clock ?? systemClock
    this.transport = options.fetch ?? globalThis.fetch
    this.random = options.random ?? Math.random
    this.signal = options.signal
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
        result.kind === 'not-found' ? (result.retryCount ?? 0) : result.retryCount,
      )
    return result.data
  }

  async getRepository(owner: string, repo: string): Promise<RepoResult<GitHubRepo>> {
    const result = await this.request('core', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, parseRepository)
    if (result.kind === 'found' && result.data.private) return { kind: 'not-found' }
    return result
  }

  getMarketplace(owner: string, repo: string, etag?: string): Promise<ConditionalRepoResult<Marketplace>> {
    const validator = safeEntityTag(etag ?? null)
    if (etag !== undefined && validator === null) throw new GitHubFatalError('Invalid marketplace ETag', null)
    const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/.claude-plugin/marketplace.json`
    return validator
      ? this.request('core', path, parseMarketplace, 'application/vnd.github.raw+json', validator)
      : this.request('core', path, parseMarketplace, 'application/vnd.github.raw+json')
  }

  private request<T>(
    bucket: RateResource,
    path: string,
    parse: (value: unknown, response: Response) => T,
    accept?: string,
  ): Promise<RepoResult<T>>
  private request<T>(
    bucket: RateResource,
    path: string,
    parse: (value: unknown, response: Response) => T,
    accept: string,
    ifNoneMatch: string,
  ): Promise<ConditionalRepoResult<T>>
  private request<T>(
    bucket: RateResource,
    path: string,
    parse: (value: unknown, response: Response) => T,
    accept = 'application/vnd.github+json',
    ifNoneMatch?: string,
  ): Promise<ConditionalRepoResult<T>> {
    const run = this.pending.then(() => {
      throwIfShutdown(this.signal)
      return this.perform(bucket, path, parse, accept, ifNoneMatch)
    })
    this.pending = run.then(
      () => {},
      () => {},
    )
    return run
  }

  private async perform<T>(
    bucket: RateResource,
    path: string,
    parse: (value: unknown, response: Response) => T,
    accept: string,
    ifNoneMatch?: string,
  ): Promise<ConditionalRepoResult<T>> {
    let secondaryCount = 0
    for (let attempt = 0; attempt < 4; attempt++) {
      await this.budget.acquire(bucket, this.signal)
      throwIfShutdown(this.signal)
      let response: Response
      try {
        response = await this.transport(`https://api.github.com${path}`, {
          signal: AbortSignal.timeout(30_000),
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: accept,
            'X-GitHub-Api-Version': '2022-11-28',
            ...(ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : {}),
          },
        })
      } catch {
        throwIfShutdown(this.signal)
        if (attempt === 3) return { kind: 'temporary-error', status: null, reason: 'GitHub network error', retryCount: attempt }
        this.budget.defer(bucket, this.transientDelay(attempt))
        continue
      }
      const action = await this.handleResponse(bucket, response, parse, attempt, secondaryCount)
      throwIfShutdown(this.signal)
      if (action.kind === 'result') return action.result
      secondaryCount = action.secondaryCount
    }
    return { kind: 'temporary-error', status: null, reason: 'GitHub retry limit exceeded', retryCount: 3 }
  }

  private async handleResponse<T>(
    bucket: RateResource,
    response: Response,
    parse: (value: unknown, response: Response) => T,
    attempt: number,
    secondaryCount: number,
  ): Promise<ResponseAction<T>> {
    this.budget.observe(bucket, response.headers)
    const delay = retryAfter(response.headers, this.clock.now())
    if (delay !== null) this.budget.defer(bucket, delay)
    const { status } = response
    if (status === 304) return { kind: 'result', result: { kind: 'not-modified', retryCount: attempt } }
    if (status === 401 || status === 422) throw new GitHubFatalError(`GitHub request rejected (${status})`, status)
    if (status === 404) return { kind: 'result', result: { kind: 'not-found', retryCount: attempt } }
    if (status === 403 || status === 429) return this.handleRateLimit(bucket, response, attempt, delay, secondaryCount)
    if (status >= 500 && status <= 599) return this.handleServerError(bucket, status, attempt, delay, secondaryCount)
    if (!response.ok)
      return { kind: 'result', result: { kind: 'temporary-error', status, reason: 'GitHub HTTP error', retryCount: attempt } }
    return this.parseResponse(bucket, response, parse, attempt, secondaryCount)
  }

  private async handleRateLimit<T>(
    bucket: RateResource,
    response: Response,
    attempt: number,
    delay: number | null,
    secondaryCount: number,
  ): Promise<ResponseAction<T>> {
    const { status } = response
    const remaining = response.headers.get('x-ratelimit-remaining')
    let secondary = status === 429 || (remaining !== '0' && delay !== null)
    if (status === 403 && remaining !== '0' && delay === null) {
      const body = await response.text().catch(() => '')
      if (/secondary rate limit|abuse detection/i.test(body)) secondary = true
      else throw new GitHubFatalError('GitHub access forbidden (403)', status)
    }
    if (secondary) secondaryCount++
    this.budget.defer(bucket, Math.max(delay ?? 0, secondary ? 60_000 * 2 ** (secondaryCount - 1) + Math.floor(this.random() * 1_000) : 0))
    if (attempt === 3)
      return { kind: 'result', result: { kind: 'temporary-error', status, reason: 'GitHub rate limited', retryCount: attempt } }
    return { kind: 'retry', secondaryCount }
  }

  private async handleServerError<T>(
    bucket: RateResource,
    status: number,
    attempt: number,
    delay: number | null,
    secondaryCount: number,
  ): Promise<ResponseAction<T>> {
    if (attempt === 3)
      return { kind: 'result', result: { kind: 'temporary-error', status, reason: 'GitHub server error', retryCount: attempt } }
    this.budget.defer(bucket, Math.max(delay ?? 0, this.transientDelay(attempt)))
    return { kind: 'retry', secondaryCount }
  }

  private async parseResponse<T>(
    bucket: RateResource,
    response: Response,
    parse: (value: unknown, response: Response) => T,
    attempt: number,
    secondaryCount: number,
  ): Promise<ResponseAction<T>> {
    try {
      return { kind: 'result', result: { kind: 'found', data: parse((await response.json()) as unknown, response) } }
    } catch {
      if (attempt === 3) {
        return {
          kind: 'result',
          result: { kind: 'temporary-error', status: response.status, reason: 'Invalid GitHub response', retryCount: attempt },
        }
      }
      this.budget.defer(bucket, this.transientDelay(attempt))
      return { kind: 'retry', secondaryCount }
    }
  }

  private transientDelay(attempt: number): number {
    return 1_000 * 2 ** attempt + Math.floor(this.random() * 250)
  }
}
