import { parseMarketplaceManifest } from '@awesome-claude-plugins/marketplace-contract'
import type { components, operations } from '@octokit/openapi-types'
import { throwIfShutdown } from '../shutdown.js'
import { type Clock, RateBudget, type RateLog, type RateResource, systemClock } from './rateBudget.js'

type SearchCodeResponse = operations['search/code']['responses'][200]['content']['application/json']
type SearchCodeRepository = SearchCodeResponse['items'][number]['repository']

export type SearchPage = Pick<SearchCodeResponse, 'total_count' | 'incomplete_results'> & {
  items: Array<{
    repository: Pick<SearchCodeRepository, 'html_url' | 'description'> & {
      node_id?: SearchCodeRepository['node_id']
      private?: SearchCodeRepository['private']
    }
  }>
}

type RepositoryResponse = components['schemas']['full-repository']

export type GitHubRepo = Pick<
  RepositoryResponse,
  'html_url' | 'name' | 'description' | 'stargazers_count' | 'forks_count' | 'subscribers_count' | 'pushed_at'
> & {
  node_id?: string
  owner: Pick<RepositoryResponse['owner'], 'login' | 'html_url'>
  pushed_at: Extract<RepositoryResponse['pushed_at'], string>
  private?: RepositoryResponse['private']
}

export type Marketplace = { plugins: unknown[]; oid?: string }

export type GitHubGraphQLRepo = GitHubRepo & { node_id: string; marketplace_oid: string | null }
export type GraphQLRateLimit = { cost: number; remaining: number; resetAt: string; limit: number; used: number }
export type GraphQLBatchResult =
  | { kind: 'found'; data: Array<GitHubGraphQLRepo | null>; rateLimit: GraphQLRateLimit }
  | { kind: 'temporary-error'; status: number | null; reason: string }

export type RepoResult<T> =
  | { kind: 'found'; data: T; etag?: string }
  | { kind: 'not-found'; retryCount?: number }
  | { kind: 'not-modified'; etag?: string }
  | { kind: 'temporary-error'; status: number | null; reason: string; retryCount: number }

type ResponseAction<T> = { kind: 'retry'; secondaryCount: number } | { kind: 'result'; result: RepoResult<T> }

export interface GitHubReader {
  searchCode(query: string, page: number): Promise<SearchPage>
  getRepository(owner: string, repo: string, etag?: string): Promise<RepoResult<GitHubRepo>>
  getMarketplace(owner: string, repo: string, etag?: string): Promise<RepoResult<Marketplace>>
  getRepositoriesByNodeId?(ids: readonly string[]): Promise<GraphQLBatchResult>
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
        (item.repository.node_id === undefined || nonempty(item.repository.node_id)) &&
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
    (value.node_id !== undefined && !nonempty(value.node_id)) ||
    typeof value.private !== 'boolean' ||
    !record(value.owner) ||
    !nonempty(value.owner.login) ||
    !nonempty(value.owner.html_url)
  ) {
    throw new Error('Invalid repository response')
  }
  return value as GitHubRepo
}

function parseGraphQLRepo(value: unknown): GitHubGraphQLRepo | null {
  if (value === null) return null
  if (
    !record(value) ||
    !nonempty(value.id) ||
    !nonempty(value.url) ||
    !nonempty(value.name) ||
    !description(value.description) ||
    !count(value.stargazerCount) ||
    !count(value.forkCount) ||
    !nonempty(value.pushedAt) ||
    typeof value.isPrivate !== 'boolean' ||
    !record(value.owner) ||
    !nonempty(value.owner.login) ||
    !nonempty(value.owner.url) ||
    !record(value.watchers) ||
    !count(value.watchers.totalCount) ||
    (value.object !== null && (!record(value.object) || !nonempty(value.object.oid)))
  ) {
    throw new Error('Invalid GraphQL repository response')
  }
  return {
    node_id: value.id,
    html_url: value.url,
    name: value.name,
    description: value.description,
    stargazers_count: value.stargazerCount,
    forks_count: value.forkCount,
    subscribers_count: value.watchers.totalCount,
    pushed_at: value.pushedAt,
    private: value.isPrivate,
    owner: { login: value.owner.login, html_url: value.owner.url },
    marketplace_oid: value.object === null ? null : (value.object as { oid: string }).oid,
  }
}

function parseGraphQLRateLimit(value: unknown): GraphQLRateLimit {
  if (
    !record(value) ||
    !count(value.cost) ||
    !count(value.remaining) ||
    !count(value.limit) ||
    !count(value.used) ||
    !nonempty(value.resetAt) ||
    Number.isNaN(Date.parse(value.resetAt))
  ) {
    throw new Error('Invalid GraphQL rate limit response')
  }
  return value as GraphQLRateLimit
}

function parseMarketplace(value: unknown): Marketplace {
  return parseMarketplaceManifest(value)
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
        result.kind === 'not-found' ? 'Code search not found' : result.kind === 'temporary-error' ? result.reason : 'Unexpected code search 304',
        result.kind === 'not-found' ? 404 : result.kind === 'temporary-error' ? result.status : 304,
        result.kind === 'not-found' ? (result.retryCount ?? 0) : result.kind === 'temporary-error' ? result.retryCount : 0,
      )
    return result.data
  }

  async getRepository(owner: string, repo: string, etag?: string): Promise<RepoResult<GitHubRepo>> {
    const result = await this.request(
      'core',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      parseRepository,
      'application/vnd.github+json',
      etag,
    )
    if (result.kind === 'found' && result.data.private) return { kind: 'not-found' }
    return result
  }

  getMarketplace(owner: string, repo: string, etag?: string): Promise<RepoResult<Marketplace>> {
    return this.request(
      'core',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/.claude-plugin/marketplace.json`,
      parseMarketplace,
      'application/vnd.github.raw+json',
      etag,
    )
  }

  private request<T>(
    bucket: RateResource,
    path: string,
    parse: (value: unknown) => T,
    accept = 'application/vnd.github+json',
    etag?: string,
  ): Promise<RepoResult<T>> {
    const run = this.pending.then(() => {
      throwIfShutdown(this.signal)
      return this.perform(bucket, path, parse, accept, etag)
    })
    this.pending = run.then(
      () => {},
      () => {},
    )
    return run
  }

  getRepositoriesByNodeId(ids: readonly string[]): Promise<GraphQLBatchResult> {
    const run = this.pending.then(() => {
      throwIfShutdown(this.signal)
      return this.performGraphQL(ids)
    })
    this.pending = run.then(
      () => {},
      () => {},
    )
    return run
  }

  private async performGraphQL(ids: readonly string[]): Promise<GraphQLBatchResult> {
    if (ids.length < 1 || ids.length > 50 || ids.some((id) => !nonempty(id))) {
      throw new GitHubFatalError('GraphQL batch must contain 1..50 node IDs', null)
    }
    let secondaryCount = 0
    for (let attempt = 0; attempt < 4; attempt++) {
      await this.budget.acquire('graphql', this.signal)
      throwIfShutdown(this.signal)
      let response: Response
      const requestStartedAt = this.clock.now()
      try {
        response = await this.transport('https://api.github.com/graphql', {
          method: 'POST',
          signal: AbortSignal.timeout(10_000),
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: JSON.stringify({
            query: `query($ids: [ID!]!) {
              nodes(ids: $ids) {
                ... on Repository {
                  id url name description stargazerCount forkCount pushedAt isPrivate
                  owner { login url }
                  watchers(first: 1) { totalCount }
                  object(expression: "HEAD:.claude-plugin/marketplace.json") { ... on Blob { oid } }
                }
              }
              rateLimit { cost remaining resetAt limit used }
            }`,
            variables: { ids },
          }),
        })
      } catch {
        throwIfShutdown(this.signal)
        if (attempt === 3) return { kind: 'temporary-error', status: null, reason: 'GitHub network error' }
        await this.clock.sleep(this.transientDelay(attempt), this.signal)
        continue
      }
      this.budget.observe('graphql', response.headers)
      const delay = retryAfter(response.headers, this.clock.now())
      if (delay !== null) this.budget.defer('graphql', delay)
      if (response.status === 401 || response.status === 422)
        throw new GitHubFatalError(`GitHub GraphQL request rejected (${response.status})`, response.status)
      if (response.status === 403 || response.status === 429) {
        const remaining = response.headers.get('x-ratelimit-remaining')
        if (remaining === '0') {
          if (attempt === 3) return { kind: 'temporary-error', status: response.status, reason: 'GitHub GraphQL rate limited' }
          continue
        }
        if (response.status === 403 && delay === null) {
          const body = await response.text().catch(() => '')
          if (!/secondary rate limit|abuse detection/i.test(body)) throw new GitHubFatalError('GitHub GraphQL access forbidden (403)', 403)
        }
        secondaryCount++
        const pause = delay ?? 60_000 * 2 ** (secondaryCount - 1) + Math.floor(this.random() * 1_000)
        this.budget.defer('graphql', pause)
        if (attempt === 3) return { kind: 'temporary-error', status: response.status, reason: 'GitHub GraphQL secondary rate limit' }
        continue
      }
      if (response.status >= 500 && response.status <= 599) {
        if (attempt === 3) return { kind: 'temporary-error', status: response.status, reason: 'GitHub GraphQL server error' }
        this.budget.defer('graphql', Math.max(delay ?? 0, this.transientDelay(attempt)))
        continue
      }
      if (!response.ok) return { kind: 'temporary-error', status: response.status, reason: 'GitHub GraphQL HTTP error' }
      try {
        const payload: unknown = await response.json()
        if (record(payload) && Array.isArray(payload.errors) && payload.errors.length > 0) {
          const message = payload.errors
            .map((error: unknown) => (record(error) && typeof error.message === 'string' ? error.message : ''))
            .join(' ')
          if (/secondary rate limit|abuse detection/i.test(message)) {
            secondaryCount++
            this.budget.defer('graphql', delay ?? 60_000 * 2 ** (secondaryCount - 1) + Math.floor(this.random() * 1_000))
            if (attempt < 3) continue
            return { kind: 'temporary-error', status: response.status, reason: 'GitHub GraphQL secondary rate limit' }
          }
          if (/rate limit exceeded|primary rate limit/i.test(message)) {
            if (attempt < 3) continue
            return { kind: 'temporary-error', status: response.status, reason: 'GitHub GraphQL rate limited' }
          }
          throw new Error('GraphQL returned errors')
        }
        if (!record(payload) || !record(payload.data) || !Array.isArray(payload.data.nodes) || payload.data.nodes.length !== ids.length) {
          throw new Error('Invalid GraphQL response')
        }
        const rateLimit = parseGraphQLRateLimit(payload.data.rateLimit)
        this.budget.observeGraphQL({ ...rateLimit, latencyMs: Math.max(0, this.clock.now() - requestStartedAt) }, response.headers)
        return { kind: 'found', data: payload.data.nodes.map(parseGraphQLRepo), rateLimit }
      } catch {
        return { kind: 'temporary-error', status: response.status, reason: 'Invalid GraphQL response' }
      }
    }
    return { kind: 'temporary-error', status: null, reason: 'GitHub GraphQL retry limit exceeded' }
  }

  private async perform<T>(bucket: RateResource, path: string, parse: (value: unknown) => T, accept: string, etag?: string): Promise<RepoResult<T>> {
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
            ...(etag ? { 'If-None-Match': etag } : {}),
            ...(etag ? { 'If-None-Match': etag } : {}),
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
    parse: (value: unknown) => T,
    attempt: number,
    secondaryCount: number,
  ): Promise<ResponseAction<T>> {
    this.budget.observe(bucket, response.headers)
    const delay = retryAfter(response.headers, this.clock.now())
    if (delay !== null) this.budget.defer(bucket, delay)
    const { status } = response
    if (status === 401 || status === 422) throw new GitHubFatalError(`GitHub request rejected (${status})`, status)
    if (status === 304) return { kind: 'result', result: { kind: 'not-modified', etag: response.headers.get('etag') ?? undefined } }
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
    parse: (value: unknown) => T,
    attempt: number,
    secondaryCount: number,
  ): Promise<ResponseAction<T>> {
    try {
      return {
        kind: 'result',
        result: {
          kind: 'found',
          data: parse((await response.json()) as unknown),
          ...(response.headers.get('etag') ? { etag: response.headers.get('etag') as string } : {}),
        },
      }
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
