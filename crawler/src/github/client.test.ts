import { marketplaceFixtures } from '@awesome-claude-plugins/marketplace-contract/fixtures'
import { describe, expect, it } from 'vitest'
import { GitHubClient, GitHubFatalError, GitHubTemporaryError } from './client.js'

const repo = {
  html_url: 'https://github.com/acme/catalog',
  name: 'catalog',
  description: null,
  stargazers_count: 12,
  forks_count: 2,
  subscribers_count: 3,
  pushed_at: '2026-09-20T00:00:00Z',
  private: false,
  owner: { login: 'acme', html_url: 'https://github.com/acme' },
}
const page = {
  total_count: 1,
  incomplete_results: false,
  items: [{ repository: { html_url: repo.html_url, description: null } }],
}

function harness(responses: Array<Response | Error>, random: () => number = () => 0) {
  let time = 0
  const requests: Array<{ url: string; init: RequestInit | undefined; time: number }> = []
  const logs: unknown[] = []
  const client = new GitHubClient({
    token: 'test-secret',
    clock: {
      now: () => time,
      sleep: async (ms) => {
        time += ms
      },
    },
    random,
    log: (event) => logs.push(event),
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init, time })
      const next = responses.shift()
      if (!next) throw new Error('Unexpected fetch')
      if (next instanceof Error) throw next
      return next
    }) as typeof fetch,
  })
  return {
    client,
    requests,
    logs,
    get time() {
      return time
    },
  }
}

function manifest(value: unknown) {
  return Response.json(value)
}

describe('GitHubClient', () => {
  it('sends encoded code search with one q, a page and a bearer token', async () => {
    const test = harness([Response.json(page)])
    expect(await test.client.searchCode('filename:marketplace.json path:.claude-plugin size:0..150', 2)).toEqual(page)

    const request = test.requests[0]
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.github.com/search/code')
    expect(url.searchParams.getAll('q')).toEqual(['filename:marketplace.json path:.claude-plugin size:0..150'])
    expect(url.searchParams.get('per_page')).toBe('100')
    expect(url.searchParams.get('page')).toBe('2')
    expect(request.init?.headers).toMatchObject({
      Authorization: 'Bearer test-secret',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    })
  })

  it('returns typed repository data and encodes owner and repo as path segments', async () => {
    const test = harness([Response.json(repo)])
    expect(await test.client.getRepository('acme team', 'cool/repo')).toEqual({ kind: 'found', data: repo })
    expect(test.requests[0].url).toBe('https://api.github.com/repos/acme%20team/cool%2Frepo')
  })

  it('treats a private repository as absent from the public catalog without retrying', async () => {
    const test = harness([Response.json({ ...repo, private: true })])
    expect(await test.client.getRepository('acme', 'catalog')).toEqual({ kind: 'not-found' })
    expect(test.requests).toHaveLength(1)
  })

  it('reads raw marketplace content and preserves an empty plugins array', async () => {
    const test = harness([manifest({ plugins: [] })])
    expect(await test.client.getMarketplace('acme', 'catalog')).toEqual({ kind: 'found', data: { plugins: [] } })
    expect(test.requests[0].url).toBe('https://api.github.com/repos/acme/catalog/contents/.claude-plugin/marketplace.json')
    expect(test.requests[0].init?.headers).toMatchObject({ Accept: 'application/vnd.github.raw+json' })
  })

  it('parses marketplace files larger than the Contents API base64 limit', async () => {
    const largeManifest = { plugins: [], padding: 'x'.repeat(1_100_000) }
    const test = harness([manifest(largeManifest)])
    expect(await test.client.getMarketplace('acme', 'catalog')).toEqual({ kind: 'found', data: { plugins: [] } })
    expect(test.requests).toHaveLength(1)
  })

  it.each(marketplaceFixtures.filter((fixture) => fixture.valid))('uses the shared marketplace contract for $name', async (fixture) => {
    const test = harness([manifest(fixture.input)])
    const result = await test.client.getMarketplace('acme', 'catalog')
    expect(result.kind).toBe('found')
    if (result.kind === 'found') expect(result.data.plugins).toHaveLength(fixture.pluginsCount)
  })

  it.each(marketplaceFixtures.filter((fixture) => !fixture.valid))('rejects invalid shared marketplace fixture: $name', async (fixture) => {
    const test = harness(Array.from({ length: 4 }, () => manifest(fixture.input)))
    const result = await test.client.getMarketplace('acme', 'catalog')
    expect(result.kind).toBe('temporary-error')
    expect(test.requests).toHaveLength(4)
  })

  it('returns definitive 404 without a retry for both enrichment endpoints', async () => {
    const test = harness([new Response('', { status: 404 }), new Response('', { status: 404 })])
    expect(await test.client.getRepository('acme', 'catalog')).toEqual({ kind: 'not-found', retryCount: 0 })
    expect(await test.client.getMarketplace('acme', 'catalog')).toEqual({ kind: 'not-found', retryCount: 0 })
    expect(test.requests).toHaveLength(2)
  })

  it.each([
    () => new Response('%%%'),
    () => new Response('not json'),
    () => manifest({}),
    () => new Response(new Uint8Array([0xff])),
    () => new Response('', { status: 200 }),
  ])('treats missing or malformed marketplace content as temporary rather than zero plugins', async (response) => {
    const test = harness(Array.from({ length: 4 }, response))
    const result = await test.client.getMarketplace('acme', 'catalog')
    expect(result).toMatchObject({ kind: 'temporary-error', retryCount: 3 })
    expect(test.requests).toHaveLength(4)
  })

  it('waits for primary reset from quota headers on the next core request', async () => {
    const test = harness([
      Response.json(repo, { headers: { 'x-ratelimit-resource': 'core', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '100' } }),
      Response.json(repo),
    ])
    await test.client.getRepository('acme', 'catalog')
    await test.client.getRepository('acme', 'catalog')
    expect(test.requests.map((request) => request.time)).toEqual([0, 101_000])
    expect(test.logs).toContainEqual({ bucket: 'core', remaining: 0 })
  })

  it('honors a Retry-After header even when a response succeeds', async () => {
    const test = harness([Response.json(repo, { headers: { 'retry-after': '20' } }), Response.json(repo)])
    await test.client.getRepository('acme', 'catalog')
    await test.client.getRepository('acme', 'catalog')
    expect(test.requests[1].time).toBeGreaterThanOrEqual(20_000)
  })

  it('passes an abort signal to fetch so stalled requests have a deadline', async () => {
    const test = harness([Response.json(repo)])
    await test.client.getRepository('acme', 'catalog')
    expect(test.requests[0].init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('retries a primary-limited 403 only after reset rather than marking the repo absent', async () => {
    const test = harness([
      new Response('', {
        status: 403,
        headers: { 'x-ratelimit-resource': 'core', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '120' },
      }),
      Response.json(repo),
    ])
    expect(await test.client.getRepository('acme', 'catalog')).toEqual({ kind: 'found', data: repo })
    expect(test.requests[1].time).toBeGreaterThan(120_000)
  })

  it('respects Retry-After and the local budget on 429', async () => {
    const test = harness([new Response('', { status: 429, headers: { 'retry-after': '30' } }), Response.json(repo)])
    expect(await test.client.getRepository('acme', 'catalog')).toEqual({ kind: 'found', data: repo })
    expect(test.requests[1].time).toBeGreaterThanOrEqual(30_000)
  })

  it('backs off for at least a minute and increases secondary delays', async () => {
    const test = harness([
      Response.json({ message: 'You have exceeded a secondary rate limit' }, { status: 403 }),
      Response.json({ message: 'You have exceeded a secondary rate limit' }, { status: 403 }),
      Response.json(repo),
    ])
    expect(await test.client.getRepository('acme', 'catalog')).toEqual({ kind: 'found', data: repo })
    expect(test.requests[1].time - test.requests[0].time).toBeGreaterThanOrEqual(60_000)
    expect(test.requests[2].time - test.requests[1].time).toBeGreaterThanOrEqual(120_000)
  })

  it('adds jitter to secondary backoff while preserving its one-minute minimum', async () => {
    const test = harness([Response.json({ message: 'secondary rate limit' }, { status: 403 }), Response.json(repo)], () => 0.5)
    expect((await test.client.getRepository('acme', 'catalog')).kind).toBe('found')
    expect(test.requests[1].time - test.requests[0].time).toBeGreaterThan(60_000)
  })

  it('stops global authentication and permission failures without leaking token or body', async () => {
    for (const status of [401, 403]) {
      const test = harness([
        Response.json(
          { message: 'test-secret' },
          {
            status,
            headers: status === 403 ? { 'x-ratelimit-remaining': '4000' } : {},
          },
        ),
      ])
      await expect(test.client.getRepository('acme', 'catalog')).rejects.toBeInstanceOf(GitHubFatalError)
      expect(test.requests).toHaveLength(1)
      expect(JSON.stringify(test.logs)).not.toContain('test-secret')
    }
  })

  it('treats an unmarked 403 as a permission failure, not an indefinite quota retry', async () => {
    const test = harness([new Response('', { status: 403 })])
    await expect(test.client.getRepository('acme', 'catalog')).rejects.toBeInstanceOf(GitHubFatalError)
    expect(test.requests).toHaveLength(1)
  })

  it('rejects invalid search queries as global configuration errors and bounds page numbers', async () => {
    const test = harness([new Response('', { status: 422 })])
    await expect(test.client.searchCode('bad query', 1)).rejects.toBeInstanceOf(GitHubFatalError)
    await expect(test.client.searchCode('good query', 11)).rejects.toBeInstanceOf(GitHubFatalError)
    expect(test.requests).toHaveLength(1)
  })

  it('never treats a malformed search response as an empty successful page', async () => {
    const test = harness(Array.from({ length: 4 }, () => Response.json({ ...page, incomplete_results: 'false' })))
    await expect(test.client.searchCode('q', 1)).rejects.toBeInstanceOf(GitHubTemporaryError)
  })

  it('preserves retries when code search ends in 404 after a retryable failure', async () => {
    const test = harness([new Response('', { status: 503 }), new Response('', { status: 404 })])

    await expect(test.client.searchCode('q', 1)).rejects.toMatchObject({
      status: 404,
      retryCount: 1,
    })
    expect(test.requests).toHaveLength(2)
  })

  it('reports zero retries when code search returns 404 on the first attempt', async () => {
    const test = harness([new Response('', { status: 404 })])

    await expect(test.client.searchCode('q', 1)).rejects.toMatchObject({
      status: 404,
      retryCount: 0,
    })
    expect(test.requests).toHaveLength(1)
  })

  it('returns temporary-error after bounded network and 5xx retries, without exposing exception text', async () => {
    const test = harness([
      new Error('test-secret'),
      new Response('', { status: 503 }),
      new Response('', { status: 502 }),
      new Response('', { status: 500 }),
    ])
    const result = await test.client.getRepository('acme', 'catalog')
    expect(result).toMatchObject({ kind: 'temporary-error', retryCount: 3 })
    expect(JSON.stringify(result)).not.toContain('test-secret')
    expect(test.requests).toHaveLength(4)
    expect(test.requests[1].time).toBeGreaterThan(test.requests[0].time)
  })

  it('does not classify an HTTP 200 with invalid repo fields as found', async () => {
    const test = harness(Array.from({ length: 4 }, () => Response.json({ ...repo, owner: {} })))
    expect((await test.client.getRepository('acme', 'catalog')).kind).toBe('temporary-error')
  })
})
it('cancels a production rate-limit wait when shutdown is requested', async () => {
  const shutdown = new AbortController()
  let requests = 0
  const client = new GitHubClient({
    token: 'test-secret',
    signal: shutdown.signal,
    log: (event) => {
      if (event.waitMs !== undefined) queueMicrotask(() => shutdown.abort())
    },
    fetch: (async () => {
      requests++
      return new Response('', {
        status: 429,
        headers: { 'Retry-After': '120' },
      })
    }) as typeof fetch,
  })

  await expect(client.getRepository('acme', 'catalog')).rejects.toMatchObject({ category: 'terminated' })
  expect(requests).toBe(1)
})

it('lets an in-flight GitHub request finish but refuses to start another after shutdown', async () => {
  const shutdown = new AbortController()
  const requests: string[] = []
  const client = new GitHubClient({
    token: 'test-secret',
    signal: shutdown.signal,
    clock: { now: () => 0, sleep: async () => {} },
    fetch: (async (input: RequestInfo | URL) => {
      requests.push(String(input))
      shutdown.abort()
      return Response.json(repo)
    }) as typeof fetch,
  })

  await expect(client.getRepository('acme', 'catalog')).rejects.toMatchObject({ category: 'terminated' })
  await expect(client.getRepository('acme', 'catalog')).rejects.toMatchObject({ category: 'terminated' })
  expect(requests).toHaveLength(1)
})

it('treats shutdown during the final transport failure as termination', async () => {
  const shutdown = new AbortController()
  let time = 0
  let requests = 0
  const client = new GitHubClient({
    token: 'test-secret',
    signal: shutdown.signal,
    clock: {
      now: () => time,
      sleep: async (milliseconds) => {
        time += milliseconds
      },
    },
    fetch: (async () => {
      requests++
      if (requests === 4) shutdown.abort()
      throw new Error('offline')
    }) as typeof fetch,
  })

  await expect(client.getRepository('acme', 'catalog')).rejects.toMatchObject({ category: 'terminated' })
  expect(requests).toBe(4)
})
