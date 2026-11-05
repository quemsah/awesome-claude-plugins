import { createServer } from 'node:http'
import Database from 'better-sqlite3'
import { afterEach, expect, it, vi } from 'vitest'
import { GitHubClient } from '../github/client.js'
import { getRepositoryById, listForHealthCheck, listPublishable, updateEnriched, upsertDiscovery } from '../storage/repositories.js'
import { beginRun, failRun, listRunErrors } from '../storage/runs.js'
import { initializeSchema } from '../storage/schema.js'
import { healthCheck } from './healthCheck.js'

const databases: Database.Database[] = []
const at = '2026-11-01T12:00:00.000Z'

function database() {
  const db = new Database(':memory:')
  initializeSchema(db)
  beginRun(db, 'health', at)
  databases.push(db)
  return db
}

afterEach(() => {
  vi.useRealTimers()
  for (const db of databases.splice(0)) db.close()
})

function client(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  let time = 0
  return new GitHubClient({
    token: 'test-secret',
    clock: {
      now: () => time,
      sleep: async (ms) => {
        time += ms
      },
    },
    fetch: (async (url, init) => respond(String(url), init)) as typeof fetch,
  })
}

function seed(db: Database.Database, url = 'https://github.com/old/project') {
  const id = upsertDiscovery(db, url, 'old project', '2020-01-01T00:00:00.000Z')
  const [, , , owner, repo] = url.split('/')
  updateEnriched(db, id, {
    owner,
    repo_name: repo,
    owner_url: `https://github.com/${owner}`,
    description: 'old project',
    stargazers_count: 5,
    forks_count: 2,
    subscribers_count: 1,
    repo_updated: '2020-01-01T00:00:00Z',
    plugins_count: 1,
  })
  return id
}

it.each([404, 410])('removes stale catalog links only after HEAD %s and an API confirmation', async (status) => {
  const db = database()
  const id = seed(db)
  const requests: string[] = []
  const reader = client((url, init) => {
    requests.push(url)
    if (url.startsWith('https://github.com/')) {
      expect(init?.method).toBe('HEAD')
      expect(new Headers(init?.headers).has('Authorization')).toBe(false)
    } else {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-secret')
    }
    return new Response(null, { status })
  })
  expect(
    await healthCheck(
      db,
      reader,
      'health',
      () => {},
      () => at,
    ),
  ).toMatchObject({ checked: 1, deleted: 1 })
  expect(getRepositoryById(db, id)).toBeNull()
  expect(listPublishable(db)).toEqual([])
  expect(requests).toEqual(['https://github.com/old/project', 'https://api.github.com/repos/old/project'])
})

it.each([200, 403, 451, 503])('retains a HEAD 404 when the confirmation API returns %s', async (status) => {
  const db = database()
  const id = seed(db)
  await healthCheck(
    db,
    client((url) =>
      url.startsWith('https://github.com/')
        ? new Response(null, { status: 404 })
        : status === 200
          ? Response.json({ html_url: 'https://github.com/old/project', private: false })
          : new Response(null, { status }),
    ),
    'health',
    () => {},
    () => at,
  )
  expect(getRepositoryById(db, id)).not.toBeNull()
})

it('isolates legally restricted repositories on direct public HEAD HTTP 451 without deleting', async () => {
  const db = database()
  const id = seed(db)
  const requests: string[] = []
  await healthCheck(
    db,
    client((url) => {
      requests.push(url)
      return new Response(null, { status: 451 })
    }),
    'health',
    () => {},
    () => at,
  )
  expect(getRepositoryById(db, id)).toMatchObject({
    last_health_check_at: at,
    blocked_at: at,
    blocked_reason: 'Unavailable for legal reasons',
  })
  expect(requests).toEqual(['https://github.com/old/project', 'https://api.github.com/repos/old/project'])
  expect(listRunErrors(db, 'health')).toMatchObject([{ error_type: 'health_check_repository_blocked' }])
  expect(listPublishable(db)).toEqual([])
})

it.each([301, 302])('updates all canonical identity fields after HEAD %s and merges duplicate URLs', async (status) => {
  const db = database()
  const id = seed(db)
  seed(db, 'https://github.com/new/renamed')
  const reader = client(
    (url) => new Response(null, url.endsWith('/old/project') ? { status, headers: { location: '/new/renamed' } } : { status: 200 }),
  )
  await healthCheck(
    db,
    reader,
    'health',
    () => {},
    () => at,
  )
  expect(listPublishable(db)).toHaveLength(1)
  expect(getRepositoryById(db, id)).toMatchObject({
    html_url: 'https://github.com/new/renamed',
    owner: 'new',
    repo_name: 'renamed',
    owner_url: 'https://github.com/new',
    last_health_check_at: at,
    stargazers_count: 5,
  })
})

it('rotates through the 200 least recently checked rows independently of pushed dates', async () => {
  const db = database()
  for (let index = 0; index < 205; index++) seed(db, `https://github.com/old/project-${index}`)
  const reader = client(() => new Response(null, { status: 200 }))
  expect(
    await healthCheck(
      db,
      reader,
      'health',
      () => {},
      () => at,
    ),
  ).toMatchObject({ checked: 200 })
  expect(db.prepare('SELECT COUNT(*) AS count FROM repositories WHERE last_health_check_at IS NULL').get()).toEqual({ count: 5 })
  await healthCheck(
    db,
    reader,
    'health',
    () => {},
    () => '2026-11-02T00:00:00.000Z',
  )
  expect(db.prepare('SELECT COUNT(*) AS count FROM repositories WHERE last_health_check_at IS NULL').get()).toEqual({ count: 0 })
})

it.each([
  [true, 1],
  [false, 1],
  [true, null],
  [false, null],
])(
  'preserves enriched metadata when a pending rename merges with a published row (pending first: %s, plugins: %s)',
  async (pendingFirst, pluginsCount) => {
    const db = database()
    const pending = () => upsertDiscovery(db, 'https://github.com/old/project', null)
    const published = () => seed(db, 'https://github.com/new/renamed')
    const first = pendingFirst ? pending() : published()
    const second = pendingFirst ? published() : pending()
    const publishedId = pendingFirst ? second : first
    db.prepare(`UPDATE repositories SET plugins_count = ?, github_node_id = 'stable-node', plugins_json = '[{"name":"plugin"}]',
    repository_etag = 'repo-etag', marketplace_etag = 'manifest-etag', marketplace_oid = 'blob-oid',
    marketplace_parser_version = 3, license = 'MIT', archived = 1 WHERE id = ?`).run(pluginsCount, publishedId)
    expect(listPublishable(db)).toHaveLength(1)
    await healthCheck(
      db,
      client(
        (url) =>
          new Response(null, url.endsWith('/old/project') ? { status: 301, headers: { location: '/new/renamed' } } : { status: 200 }),
      ),
      'health',
      () => {},
      () => at,
    )
    expect(listPublishable(db)).toHaveLength(1)
    expect(getRepositoryById(db, first)).toMatchObject({
      html_url: 'https://github.com/new/renamed',
      owner: 'new',
      repo_name: 'renamed',
      stargazers_count: 5,
      forks_count: 2,
      subscribers_count: 1,
      plugins_count: pluginsCount,
      plugins_json: '[{"name":"plugin"}]',
      github_node_id: 'stable-node',
      repository_etag: 'repo-etag',
      marketplace_etag: 'manifest-etag',
      marketplace_oid: 'blob-oid',
      marketplace_parser_version: 3,
      license: 'MIT',
      archived: 1,
    })
  },
)

it.each([403, 429, 500, 503])('keeps rows and advances the health queue on temporary HTTP %s', async (status) => {
  const db = database()
  const id = seed(db)
  await healthCheck(
    db,
    client(() => new Response(null, { status })),
    'health',
    () => {},
    () => at,
  )
  expect(getRepositoryById(db, id)).toMatchObject({ last_health_check_at: at, owner: 'old' })
  expect(listRunErrors(db, 'health')).toMatchObject([{ phase: 'health_check', error_type: `health_check_http_${status}` }])
})

it.each(['https://example.com/new/renamed', '/login', '/new/renamed/issues'])(
  'ignores redirects outside a canonical public repository: %s',
  async (location) => {
    const db = database()
    const id = seed(db)
    await healthCheck(
      db,
      client(() => new Response(null, { status: 302, headers: { location } })),
      'health',
      () => {},
      () => at,
    )
    expect(getRepositoryById(db, id)).toMatchObject({ html_url: 'https://github.com/old/project', owner: 'old' })
  },
)

it('does not write a health response after the run stops', async () => {
  const db = database()
  const id = seed(db)
  const reader = client(() => {
    failRun(db, 'health', at, 'stopped')
    return new Response(null, { status: 404 })
  })
  await expect(
    healthCheck(
      db,
      reader,
      'health',
      () => {},
      () => at,
    ),
  ).rejects.toThrow()
  expect(getRepositoryById(db, id)).not.toBeNull()
})

it('keeps a catalog publishable through real HTTP HEAD responses and a rename chain', async () => {
  const db = database()
  seed(db, 'https://github.com/old/deleted')
  seed(db, 'https://github.com/old/gone')
  seed(db, 'https://github.com/old/legal')
  const renamed = seed(db)
  const healthy = seed(db, 'https://github.com/old/healthy')
  const unavailable = seed(db, 'https://github.com/old/unavailable')
  const healthyCatalogDate = getRepositoryById(db, healthy)?.catalog_updated_at
  const methods: string[] = []
  const server = createServer((request, response) => {
    methods.push(request.method ?? '')
    const routes: Record<string, { status: number; location?: string }> = {
      '/old/deleted': { status: 404 },
      '/old/gone': { status: 410 },
      '/old/legal': { status: 451 },
      '/old/project': { status: 301, location: '/middle/project' },
      '/middle/project': { status: 302, location: 'https://github.com/new/canonical' },
      '/old/unavailable': { status: 503 },
    }
    const route = routes[(request.url ?? '').replace(/^\/repos\//, '/')] ?? { status: 200 }
    response.writeHead(route.status, route.location ? { location: route.location } : {})
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing HTTP fixture address')
    const reader = client((url, init) => fetch(`http://127.0.0.1:${address.port}${new URL(url).pathname}`, init))
    expect(
      await healthCheck(
        db,
        reader,
        'health',
        () => {},
        () => at,
      ),
    ).toEqual({
      checked: 6,
      deleted: 2,
      renamed: 1,
      warnings: 2,
    })
    expect(methods.filter((method) => method === 'HEAD')).toHaveLength(8)
    expect(methods.filter((method) => method === 'GET')).toHaveLength(3)
    expect(listPublishable(db).map(({ html_url }) => html_url)).toEqual([
      'https://github.com/new/canonical',
      'https://github.com/old/healthy',
      'https://github.com/old/unavailable',
    ])
    expect(getRepositoryById(db, renamed)).toMatchObject({ owner: 'new', repo_name: 'canonical' })
    expect(getRepositoryById(db, healthy)?.catalog_updated_at).toBe(healthyCatalogDate)
    expect(getRepositoryById(db, unavailable)?.html_url).toBe('https://github.com/old/unavailable')
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})

it('rotates past 200 malformed URLs so a valid unchecked repository can be reached', async () => {
  const db = database()
  for (let index = 0; index < 200; index++) upsertDiscovery(db, `https://github.com/invalid/path/issues-${index}`, null)
  const id = seed(db)
  const reader = client(() => new Response(null, { status: 200 }))
  await healthCheck(
    db,
    reader,
    'health',
    () => {},
    () => at,
  )
  await healthCheck(
    db,
    reader,
    'health',
    () => {},
    () => '2026-11-02T00:00:00.000Z',
  )
  expect(getRepositoryById(db, id)?.last_health_check_at).toBe('2026-11-02T00:00:00.000Z')
})

it('checks links concurrently with at most four requests in flight', async () => {
  const db = database()
  for (let index = 0; index < 12; index++) seed(db, `https://github.com/team/project-${index}`)
  let active = 0
  let peak = 0
  const reader = client(async () => {
    active++
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 1))
    active--
    return new Response(null, { status: 200 })
  })
  expect(
    await healthCheck(
      db,
      reader,
      'health',
      () => {},
      () => at,
    ),
  ).toMatchObject({ checked: 12 })
  expect(peak).toBe(4)
  expect(active).toBe(0)
})

it('ends the phase after 30 seconds and cancels in-flight requests before returning', async () => {
  vi.useFakeTimers()
  const db = database()
  for (let index = 0; index < 12; index++) seed(db, `https://github.com/team/project-${index}`)
  let active = 0
  const reader = client(() => new Response(null, { status: 200 }))
  reader.checkRepository = async (_owner, _repo, options) =>
    new Promise((_resolve, reject) => {
      active++
      options?.signal?.addEventListener(
        'abort',
        () => {
          active--
          reject(new Error('deadline'))
        },
        { once: true },
      )
    })
  const pending = healthCheck(
    db,
    reader,
    'health',
    () => {},
    () => at,
  )
  await vi.advanceTimersByTimeAsync(30_000)
  const result = await pending
  expect(active).toBe(0)
  expect(result).toMatchObject({ checked: 0, warnings: 1 })
  expect(listPublishable(db)).toHaveLength(12)
  expect(listRunErrors(db, 'health')).toMatchObject([{ error_type: 'health_check_timeout' }])
})

it('keeps a failed network request in the catalog and rotates it behind unchecked rows', async () => {
  const db = database()
  const id = seed(db)
  await healthCheck(
    db,
    client(() => {
      throw new Error('offline')
    }),
    'health',
    () => {},
    () => at,
  )
  expect(getRepositoryById(db, id)).toMatchObject({ last_health_check_at: at, html_url: 'https://github.com/old/project' })
  expect(listRunErrors(db, 'health')).toMatchObject([{ error_type: 'health_check_network' }])
})

it('isolates a blocked repository, updates last_health_check_at, and excludes it from subsequent health check selection within 7-day TTL', async () => {
  const db = database()
  const id = seed(db, 'https://github.com/team/blocked-repo')
  const checkTime = '2026-11-05T10:00:00.000Z'
  const reader = client(() => new Response(null, { status: 200 }))
  reader.checkRepository = async () => ({
    kind: 'repository-blocked' as const,
    status: 403,
    reason: 'Repository access blocked',
    blockReason: 'private_information',
    blockedAt: '2020-01-01T00:00:00Z',
    retryCount: 0,
  })

  const summary = await healthCheck(
    db,
    reader,
    'health',
    () => {},
    () => checkTime,
  )

  expect(summary).toMatchObject({ checked: 1, deleted: 0, warnings: 1 })
  const row = getRepositoryById(db, id)
  expect(row).toMatchObject({
    blocked_at: checkTime,
    blocked_reason: 'private_information',
    last_health_check_at: checkTime,
  })

  // Within 7 days, it is excluded from listForHealthCheck
  const nextDay = '2026-11-06T10:00:00.000Z'
  expect(listForHealthCheck(db, nextDay).map((r) => r.id)).not.toContain(id)

  // After 8 days (TTL expired), it is included again for re-check
  const eightDaysLater = '2026-11-13T10:00:00.000Z'
  expect(listForHealthCheck(db, eightDaysLater).map((r) => r.id)).toContain(id)
})

it('retains blocked state during health check even when page is accessible until authenticated enrichment succeeds', async () => {
  const db = database()
  const id = seed(db, 'https://github.com/restored/repo')
  const expiredTime = '2026-10-26T10:00:00.000Z'
  const checkTime = '2026-11-05T10:00:00.000Z'

  db.prepare('UPDATE repositories SET blocked_at = ?, blocked_reason = ? WHERE id = ?').run(expiredTime, 'private_information', id)

  const reader = client(() => new Response(null, { status: 200 }))
  const summary = await healthCheck(
    db,
    reader,
    'health',
    () => {},
    () => checkTime,
  )

  expect(summary).toMatchObject({ checked: 1, deleted: 0, warnings: 0 })
  const row = getRepositoryById(db, id)
  expect(row).toMatchObject({
    blocked_at: expiredTime,
    blocked_reason: 'private_information',
    last_health_check_at: checkTime,
  })
})

it('excludes an unblocked duplicate record when a sibling sharing github_node_id has an active block', () => {
  const db = database()
  const nodeId = 'shared-node-id-health'
  const checkTime = '2026-11-05T10:00:00.000Z'
  const activeBlockTime = '2026-11-04T10:00:00.000Z'

  const id1 = seed(db, 'https://github.com/alias/active-block')
  const id2 = seed(db, 'https://github.com/alias/unblocked-sibling')

  db.prepare('UPDATE repositories SET github_node_id = ?, blocked_at = ?, blocked_reason = ? WHERE id = ?').run(
    nodeId,
    activeBlockTime,
    'dmca',
    id1,
  )
  db.prepare('UPDATE repositories SET github_node_id = ?, blocked_at = NULL WHERE id = ?').run(nodeId, id2)

  const candidateIds = listForHealthCheck(db, checkTime).map((r) => r.id)
  expect(candidateIds).not.toContain(id1)
  expect(candidateIds).not.toContain(id2)
})
