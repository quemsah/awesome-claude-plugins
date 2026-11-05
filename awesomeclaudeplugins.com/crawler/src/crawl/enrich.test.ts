import Database from 'better-sqlite3'
import { afterEach, expect, it, vi } from 'vitest'
import {
  GitHubFatalError,
  type GitHubGraphQLMarketplaceBlob,
  type GitHubGraphQLRepo,
  type GitHubReader,
  type GitHubRepo,
  type Marketplace,
  type RepoResult,
} from '../github/client.js'
import { MARKETPLACE_INVALID_CONTENT_CACHE_VERSION, MARKETPLACE_PARSER_VERSION } from '../github/marketplace.js'
import { renderRepos } from '../output/catalogSnapshot.js'
import { listCoreComplete, listPublishable, markRepositoryBlocked, updateEnriched, upsertDiscovery } from '../storage/repositories.js'
import { beginRun, completeRun, getRun, listRunErrors } from '../storage/runs.js'
import { initializeSchema } from '../storage/schema.js'
import { enrichRepositories } from './enrich.js'

const databases: Database.Database[] = []

it.each(['rest', 'graphql'])('reports the missing standalone manifest when removing through %s', async (transport) => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', null, undefined, 'node-standalone')
  const api = reader(undefined, async () => ({ kind: 'not-found' }))
  if (transport === 'graphql')
    api.getRepositoriesByNodeId = async () => ({
      kind: 'found',
      data: [{ ...githubRepo('team', 'repo'), node_id: 'node-standalone', marketplace_oid: null }],
      rateLimit: { cost: 1, remaining: 4999, resetAt: '2026-12-01T00:00:00Z', limit: 5000, used: 1 },
    })
  const log = vi.fn()
  await enrichRepositories(db, api, 'crawl-1', undefined, undefined, log)
  expect(db.prepare('SELECT id FROM repositories WHERE id = ?').get(id)).toBeUndefined()
  expect(log).toHaveBeenCalledWith(
    expect.objectContaining({
      event: 'crawl.repository_removed',
      category: 'plugin_manifest_not_found',
      message: 'Plugin manifest not found for team/repo; removing repository',
      request: 'GET /repos/team/repo/contents/.claude-plugin/plugin.json',
    }),
  )
})

it.each([null, 'marketplace'] as const)(
  'keeps a selected canonical snapshot coherent after rename and invalid marketplace (kind %s)',
  async (kind) => {
    const db = database()
    const oldId = upsertDiscovery(db, 'https://github.com/team/old', null)
    const duplicateId = upsertDiscovery(db, 'https://github.com/team/canonical', null)
    ready(db, oldId, 'team', 'old')
    ready(db, duplicateId, 'team', 'canonical')
    db.prepare(`UPDATE repositories SET manifest_kind = 'standalone-plugin', plugins_count = 1,
    plugins_json = '[{"name":"old-plugin"}]', plugin_manifest_etag = '"old-plugin"', plugin_manifest_parser_version = 1 WHERE id = ?`).run(
      oldId,
    )
    db.prepare(`UPDATE repositories SET manifest_kind = ?, plugins_count = 1,
    plugins_json = '[{"name":"marketplace-plugin"}]', marketplace_oid = ?, marketplace_etag = '"marketplace"', marketplace_parser_version = ? WHERE id = ?`).run(
      kind,
      'a'.repeat(40),
      MARKETPLACE_PARSER_VERSION,
      duplicateId,
    )
    const api = reader(
      async () => ({ kind: 'found', data: githubRepo('team', 'canonical') }),
      async () => ({
        kind: 'invalid-content',
        failure: 'invalid-manifest',
        status: 200,
        reason: 'invalid marketplace',
        retryCount: 0,
      }),
    )
    await enrichRepositories(db, api, 'crawl-1')
    const preserved = db
      .prepare('SELECT id, manifest_kind, plugins_json, plugin_manifest_etag, plugin_manifest_parser_version FROM repositories')
      .get()
    completeRun(db, 'crawl-1', '2026-09-23T01:00:00Z', 0)
    beginRun(db, 'crawl-2', '2026-09-24T00:00:00Z')
    api.getMarketplace = async () => ({ kind: 'not-found' })
    let pluginRequests = 0
    api.getPluginManifest = async (_owner, _repo, etag) => {
      pluginRequests++
      expect(etag).toBeUndefined()
      return pluginRequests === 1 ? { kind: 'not-modified' } : { kind: 'found', data: { name: 'actual-standalone' } }
    }
    await enrichRepositories(db, api, 'crawl-2')
    expect(preserved).toEqual({
      id: oldId,
      manifest_kind: 'marketplace',
      plugins_json: '[{"name":"marketplace-plugin"}]',
      plugin_manifest_etag: null,
      plugin_manifest_parser_version: null,
    })
    expect(pluginRequests).toBe(2)
    expect(db.prepare('SELECT id, manifest_kind, plugins_json FROM repositories').get()).toEqual({
      id: oldId,
      manifest_kind: 'standalone-plugin',
      plugins_json: '[{"name":"actual-standalone"}]',
    })
  },
)

it.each(['found', 'invalid-content', 'temporary-error'] as const)('does not try a plugin when marketplace is %s', async (kind) => {
  const db = database()
  upsertDiscovery(db, 'https://github.com/team/repo', null)
  const result: RepoResult<Marketplace> =
    kind === 'found'
      ? { kind, data: { plugins: [] } }
      : kind === 'invalid-content'
        ? { kind, failure: 'invalid-manifest', status: 200, reason: 'bad', retryCount: 0 }
        : { kind, status: 429, reason: 'limited', retryCount: 0, retryable: false }
  const api = reader(undefined, async () => result)
  api.getPluginManifest = async () => {
    throw new Error('Plugin fallback must only follow marketplace 404')
  }
  await enrichRepositories(db, api, 'crawl-1')
})

it.each(['valid', 'invalid-summary', 'stale-parser'])('recovers plugin 304 only with usable cached standalone data: %s', async (cache) => {
  const usable = cache === 'valid'
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', null)
  ready(db, id)
  db.prepare(
    "UPDATE repositories SET manifest_kind = 'standalone-plugin', plugins_count = 1, plugins_json = ?, plugin_manifest_etag = '\"plugin\"', plugin_manifest_parser_version = 1 WHERE id = ?",
  ).run(cache === 'invalid-summary' ? '[]' : '[{"name":"reviewer"}]', id)
  if (cache === 'stale-parser') db.prepare('UPDATE repositories SET plugin_manifest_parser_version = 2 WHERE id = ?').run(id)
  const api = reader(undefined, async () => ({ kind: 'not-found' }))
  let requests = 0
  api.getPluginManifest = async (_owner, _repo, etag) => {
    requests++
    if (usable) {
      expect(etag).toBe('"plugin"')
      return { kind: 'not-modified' }
    }
    expect(etag).toBeUndefined()
    return requests === 1 ? { kind: 'not-modified' } : { kind: 'found', data: { name: 'recovered' } }
  }
  await enrichRepositories(db, api, 'crawl-1')
  expect(db.prepare('SELECT plugins_count, plugins_json FROM repositories WHERE id = ?').get(id)).toEqual({
    plugins_count: 1,
    plugins_json: usable ? '[{"name":"reviewer"}]' : '[{"name":"recovered"}]',
  })
  expect(requests).toBe(usable ? 1 : 2)
})

it.each(['rest', 'graphql'])('accepts a root standalone plugin through %s fallback', async (transport) => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', null, undefined, 'node-standalone')
  const api = reader(undefined, async () => ({ kind: 'not-found' }))
  api.getPluginManifest = async () => ({ kind: 'found', data: { name: 'Review Tools', description: 'A reviewer' }, etag: '"plugin"' })
  if (transport === 'graphql')
    api.getRepositoriesByNodeId = async () => ({
      kind: 'found',
      data: [{ ...githubRepo('team', 'repo'), node_id: 'node-standalone', marketplace_oid: null }],
      rateLimit: { cost: 1, remaining: 4999, resetAt: '2026-12-01T00:00:00Z', limit: 5000, used: 1 },
    })
  await enrichRepositories(db, api, 'crawl-1')
  expect(
    db
      .prepare('SELECT plugins_count, manifest_kind, plugin_manifest_etag, marketplace_etag, plugins_json FROM repositories WHERE id = ?')
      .get(id),
  ).toEqual({
    plugins_count: 1,
    manifest_kind: 'standalone-plugin',
    plugin_manifest_etag: '"plugin"',
    marketplace_etag: null,
    plugins_json: '[{"name":"Review Tools","description":"A reviewer"}]',
  })
})

it('keeps the accepted standalone snapshot on a transient plugin error', async () => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', null)
  ready(db, id)
  db.prepare(
    'UPDATE repositories SET manifest_kind = \'standalone-plugin\', plugins_count = 1, plugins_json = \'[{"name":"reviewer"}]\' WHERE id = ?',
  ).run(id)
  const api = reader(undefined, async () => ({ kind: 'not-found' }))
  api.getPluginManifest = async () => ({ kind: 'temporary-error', status: 503, reason: 'offline', retryCount: 0, retryable: false })
  await enrichRepositories(db, api, 'crawl-1')
  expect(db.prepare('SELECT plugins_count, manifest_kind FROM repositories WHERE id = ?').get(id)).toEqual({
    plugins_count: 1,
    manifest_kind: 'standalone-plugin',
  })
})

function database(): Database.Database {
  const db = new Database(':memory:')
  initializeSchema(db)
  beginRun(db, 'crawl-1', '2026-09-23T00:00:00Z')
  databases.push(db)
  return db
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})

function githubRepo(owner: string, name: string): GitHubRepo {
  return {
    html_url: `https://github.com/${owner}/${name}`,
    name,
    description: 'fresh',
    stargazers_count: 10,
    forks_count: 2,
    subscribers_count: 0,
    pushed_at: '2026-09-22T12:00:00Z',
    private: false,
    owner: { login: owner, html_url: `https://github.com/${owner}` },
  }
}

function reader(
  getRepository: (owner: string, repo: string) => Promise<RepoResult<GitHubRepo>> = async (owner, repo) => ({
    kind: 'found',
    data: githubRepo(owner, repo),
  }),
  getMarketplace: (owner: string, repo: string) => Promise<RepoResult<Marketplace>> = async () => ({
    kind: 'found',
    data: { plugins: [] },
  }),
): GitHubReader {
  return {
    getPluginManifest: async () => ({ kind: 'not-found' }),
    searchRepositories: async () => {
      throw new Error('Repository search is unused in this fixture')
    },
    searchCode: async () => {
      throw new Error('enrichment must not search')
    },
    getRepository,
    getMarketplace,
  }
}

function ready(db: Database.Database, id: number, owner = 'team', repo = 'repo'): void {
  updateEnriched(db, id, {
    stargazers_count: 1,
    forks_count: 1,
    subscribers_count: 1,
    description: 'original',
    owner,
    owner_url: `https://github.com/${owner}`,
    repo_name: repo,
    repo_updated: '2024-01-01T00:00:00Z',
    plugins_count: 3,
    plugins_json: '[]',
  })
}

const validMarketplaceFixture = (() => {
  const input = {
    name: 'catalog',
    owner: { name: 'maintainer' },
    plugins: [
      { name: 'plugin-one', source: './plugins/plugin-one' },
      { name: 'plugin-two', source: './plugins/plugin-two' },
    ],
  }
  return { input, pluginsCount: input.plugins.length }
})()

function graphQLMarketplaceBlob(
  repositoryNodeId: string,
  oid: string,
  overrides: Partial<GitHubGraphQLMarketplaceBlob> = {},
): GitHubGraphQLMarketplaceBlob {
  const text = JSON.stringify(validMarketplaceFixture.input)
  return {
    repository_node_id: repositoryNodeId,
    oid,
    text,
    byte_size: text.length,
    is_binary: false,
    is_truncated: false,
    ...overrides,
  }
}

it('pages by id after deleting blank and 404 rows, visiting newly discovered ids once', async () => {
  const db = database()
  for (let id = 1; id <= 53; id++) {
    db.prepare('INSERT INTO repositories (id, html_url, createdAt, updatedAt) VALUES (?, ?, ?, ?)').run(
      id,
      id === 1 ? null : id === 50 ? '   ' : `https://github.com/team/repo${id}`,
      'original-date',
      'original-date',
    )
  }
  const duplicate = upsertDiscovery(db, 'https://github.com/team/repo51', 'duplicate search hit')
  expect(duplicate).toBe(51)
  const newId = upsertDiscovery(db, 'https://github.com/team/new', null)
  const seen: string[] = []
  const client = reader(
    async (owner, name) => {
      seen.push(name)
      return name === 'repo49' ? { kind: 'not-found' } : { kind: 'found', data: githubRepo(owner, name) }
    },
    async () => ({ kind: 'found', data: { plugins: [] } }),
  )

  const counts = await enrichRepositories(db, client, 'crawl-1')

  expect(counts).toEqual({
    updated: 0,
    unchangedOnError: 0,
    newReady: 51,
    newIncomplete: 0,
    deleted404: 1,
    deletedBlankUrl: 2,
    conclusive: 52,
    warnings: 0,
    deferredCandidates: 0,
    knownInvalidSkipped: 0,
  })
  expect(seen).toHaveLength(52)
  expect(seen).toContain('repo51')
  expect(seen).toContain('new')
  expect(db.prepare('SELECT id FROM repositories WHERE id IN (1, 49, 50)').all()).toEqual([])
  expect(db.prepare('SELECT id, html_url, createdAt, plugins_count FROM repositories WHERE id = ?').get(newId)).toEqual({
    id: newId,
    html_url: 'https://github.com/team/new',
    createdAt: expect.any(String),
    plugins_count: 0,
  })
})

it('visits exactly 50 rows without repeating the last row of the batch', async () => {
  const db = database()
  for (let i = 1; i <= 50; i++) upsertDiscovery(db, `https://github.com/team/repo${i}`, null)
  const getRepository = vi.fn(async (owner: string, name: string) => ({ kind: 'found' as const, data: githubRepo(owner, name) }))

  expect((await enrichRepositories(db, reader(getRepository), 'crawl-1')).newReady).toBe(50)
  expect(getRepository).toHaveBeenCalledTimes(50)
})

it('limits per-run enrichment of unprocessed marketplace candidates and leaves the rest queued', async () => {
  const db = database()
  upsertDiscovery(db, 'https://github.com/team/candidate-1', 'first')
  upsertDiscovery(db, 'https://github.com/team/candidate-2', 'second')
  upsertDiscovery(db, 'https://github.com/team/candidate-3', 'third')
  const fetched: string[] = []

  const result = await enrichRepositories(
    db,
    reader(
      async (owner, repo) => {
        fetched.push(`${owner}/${repo}`)
        return { kind: 'found', data: githubRepo(owner, repo) }
      },
      async () => ({ kind: 'found', data: validMarketplaceFixture.input }),
    ),
    'crawl-1',
    undefined,
    () => '2026-10-30T12:00:00Z',
    undefined,
    2,
  )

  expect(fetched).toEqual(['team/candidate-1', 'team/candidate-2'])
  expect(result.deferredCandidates).toBe(1)
  expect(db.prepare('SELECT plugins_count FROM repositories ORDER BY id').all()).toEqual([
    { plugins_count: validMarketplaceFixture.pluginsCount },
    { plugins_count: validMarketplaceFixture.pluginsCount },
    { plugins_count: null },
  ])
})

it('rotates the candidate cap so a failing low-id candidate does not starve later candidates', async () => {
  const db = database()
  upsertDiscovery(db, 'https://github.com/team/candidate-1', 'first')
  upsertDiscovery(db, 'https://github.com/team/candidate-2', 'second')
  const firstRunFetches: string[] = []
  const failingReader = reader(async (_owner, repo) => {
    firstRunFetches.push(repo)
    return { kind: 'temporary-error', status: 503, reason: 'offline', retryCount: 0 }
  })
  const first = await enrichRepositories(db, failingReader, 'crawl-1', undefined, () => '2026-10-30T12:00:00Z', undefined, 1)
  expect(firstRunFetches).toContain('candidate-1')
  expect(first.deferredCandidates).toBe(1)
  completeRun(db, 'crawl-1', '2026-10-30T12:30:00Z', first.warnings)
  beginRun(db, 'crawl-2', '2026-10-31T12:00:00Z')

  const laterRunFetches: string[] = []
  const second = await enrichRepositories(
    db,
    reader(
      async (_owner, repo) => {
        laterRunFetches.push(repo)
        return { kind: 'found', data: githubRepo('team', repo) }
      },
      async () => ({ kind: 'found', data: validMarketplaceFixture.input }),
    ),
    'crawl-2',
    undefined,
    () => '2026-10-31T12:00:00Z',
    undefined,
    1,
  )

  expect(laterRunFetches).toContain('candidate-2')
  expect(second.deferredCandidates).toBe(1)
})

it('uses batched GraphQL metadata and skips marketplace REST when the stored OID is unchanged', async () => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old', new Date().toISOString(), 'MDEwOlJlcG9zaXRvcnkx')
  ready(db, id)
  const oid = 'a'.repeat(40)
  db.prepare('UPDATE repositories SET marketplace_oid = ?, marketplace_parser_version = ? WHERE id = ?').run(
    oid,
    MARKETPLACE_PARSER_VERSION,
    id,
  )
  const repository: GitHubGraphQLRepo = { ...githubRepo('team', 'repo'), node_id: 'new-global-id', marketplace_oid: oid }
  const getRepositoriesByNodeId = vi.fn(async () => ({
    kind: 'found' as const,
    data: [repository],
    rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
  }))
  const getRepository = vi.fn(async () => ({ kind: 'temporary-error' as const, status: 500, reason: 'must use GraphQL', retryCount: 0 }))
  const getMarketplace = vi.fn(async () => ({ kind: 'temporary-error' as const, status: 500, reason: 'OID unchanged', retryCount: 0 }))
  const client = { ...reader(getRepository, getMarketplace), getRepositoriesByNodeId }

  const counts = await enrichRepositories(db, client, 'crawl-1')

  expect(counts).toMatchObject({ updated: 1, conclusive: 1, warnings: 0 })
  expect(getRepositoriesByNodeId).toHaveBeenCalledWith(['MDEwOlJlcG9zaXRvcnkx'])
  expect(getRepository).not.toHaveBeenCalled()
  expect(getMarketplace).not.toHaveBeenCalled()
  expect(db.prepare('SELECT github_node_id FROM repositories WHERE id = ?').get(id)).toEqual({
    github_node_id: 'MDEwOlJlcG9zaXRvcnkx',
  })
})

it('rechecks an unchanged OID when the cached plugin count is missing', async () => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old', new Date().toISOString(), 'MDEwOlJlcG9zaXRvcnkx')
  ready(db, id)
  const oid = 'a'.repeat(40)
  db.prepare('UPDATE repositories SET marketplace_oid = ?, marketplace_etag = ?, plugins_count = NULL WHERE id = ?').run(oid, '"old"', id)
  const getMarketplace = vi.fn(async () => ({ kind: 'found' as const, data: { plugins: [1, 2] }, etag: '"new"' }))
  const client = {
    ...reader(undefined, getMarketplace),
    getRepositoriesByNodeId: async () => ({
      kind: 'found' as const,
      data: [{ ...githubRepo('team', 'repo'), node_id: 'MDEwOlJlcG9zaXRvcnkx', marketplace_oid: oid }],
      rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
    }),
  }

  const counts = await enrichRepositories(db, client, 'crawl-1')

  expect(getMarketplace).toHaveBeenCalledWith('team', 'repo', undefined, { maxAttempts: 1 })
  expect(counts).toMatchObject({ updated: 1, conclusive: 1, warnings: 0 })
  expect(db.prepare('SELECT plugins_count, marketplace_etag, marketplace_parser_version FROM repositories WHERE id = ?').get(id)).toEqual({
    plugins_count: 2,
    marketplace_etag: '"new"',
    marketplace_parser_version: MARKETPLACE_PARSER_VERSION,
  })
})

it('retains the previous OID when REST fallback cannot prove it matches GraphQL metadata', async () => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old', new Date().toISOString(), 'MDEwOlJlcG9zaXRvcnkx')
  ready(db, id)
  db.prepare('UPDATE repositories SET marketplace_oid = ?, marketplace_etag = ? WHERE id = ?').run('a'.repeat(40), '"old"', id)
  const repository: GitHubGraphQLRepo = {
    ...githubRepo('team', 'repo'),
    node_id: 'MDEwOlJlcG9zaXRvcnkx',
    marketplace_oid: 'b'.repeat(40),
  }
  const getMarketplace = vi.fn(async () => ({
    kind: 'found' as const,
    data: { plugins: [1, 2] },
    etag: '"new"',
  }))
  const client = {
    ...reader(undefined, getMarketplace),
    getRepositoriesByNodeId: async () => ({
      kind: 'found' as const,
      data: [repository],
      rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
    }),
  }

  await enrichRepositories(db, client, 'crawl-1')

  expect(getMarketplace).toHaveBeenCalledWith('team', 'repo', undefined, { maxAttempts: 1 })
  expect(db.prepare('SELECT plugins_count, marketplace_oid, marketplace_etag FROM repositories WHERE id = ?').get(id)).toEqual({
    plugins_count: 2,
    marketplace_oid: 'a'.repeat(40),
    marketplace_etag: '"new"',
  })
})

it('bypasses a cached marketplace ETag when the plugin count is missing', async () => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old', new Date().toISOString(), 'MDEwOlJlcG9zaXRvcnkx')
  ready(db, id)
  const oid = 'a'.repeat(40)
  db.prepare(
    'UPDATE repositories SET plugins_count = NULL, marketplace_oid = ?, marketplace_etag = ?, marketplace_parser_version = 2 WHERE id = ?',
  ).run(oid, '"old"', id)
  const getMarketplace = vi.fn(async () => ({ kind: 'found' as const, data: { plugins: [1, 2] }, etag: '"new"' }))
  const client = {
    ...reader(undefined, getMarketplace),
    getRepositoriesByNodeId: async () => ({
      kind: 'found' as const,
      data: [{ ...githubRepo('team', 'repo'), node_id: 'MDEwOlJlcG9zaXRvcnkx', marketplace_oid: oid }],
      rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
    }),
  }

  const counts = await enrichRepositories(db, client, 'crawl-1')

  expect(getMarketplace).toHaveBeenCalledWith('team', 'repo', undefined, { maxAttempts: 1 })
  expect(counts).toMatchObject({ updated: 1, conclusive: 1, warnings: 0 })
  expect(db.prepare('SELECT plugins_count, marketplace_etag FROM repositories WHERE id = ?').get(id)).toEqual({
    plugins_count: 2,
    marketplace_etag: '"new"',
  })
})

it('keeps the old plugin count and OID when changed content unexpectedly returns 304', async () => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old', new Date().toISOString(), 'MDEwOlJlcG9zaXRvcnkx')
  ready(db, id)
  db.prepare('UPDATE repositories SET marketplace_oid = ?, marketplace_etag = ? WHERE id = ?').run('a'.repeat(40), '"old"', id)
  const before = db.prepare('SELECT * FROM repositories WHERE id = ?').get(id)
  const getMarketplace = vi.fn(async () => ({ kind: 'not-modified' as const, etag: '"old"' }))
  const client = {
    ...reader(undefined, getMarketplace),
    getRepositoriesByNodeId: async () => ({
      kind: 'found' as const,
      data: [{ ...githubRepo('team', 'repo'), node_id: 'MDEwOlJlcG9zaXRvcnkx', marketplace_oid: 'b'.repeat(40) }],
      rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
    }),
  }

  const counts = await enrichRepositories(db, client, 'crawl-1')

  expect(getMarketplace).toHaveBeenCalledWith('team', 'repo', undefined, { maxAttempts: 1 })
  expect(db.prepare('SELECT * FROM repositories WHERE id = ?').get(id)).toEqual(before)
  expect(counts).toMatchObject({ updated: 0, unchangedOnError: 1, warnings: 1, conclusive: 0 })
  expect(listRunErrors(db, 'crawl-1').map(({ error_type }) => error_type)).toEqual(['marketplace_not_modified_after_oid_change'])
})

it('batches changed marketplace content across legacy node-id migration and treats the content OID as authoritative', async () => {
  const db = database()
  const requestedNodeId = 'MDEwOlJlcG9zaXRvcnkx'
  const returnedNodeId = 'R_kgDO_new-format'
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old', new Date().toISOString(), requestedNodeId)
  ready(db, id)
  const metadataOid = 'b'.repeat(40)
  const contentOid = 'c'.repeat(40)
  db.prepare('UPDATE repositories SET marketplace_oid = ?, marketplace_parser_version = 2 WHERE id = ?').run('a'.repeat(40), id)
  const getMarketplace = vi.fn(async () => ({ kind: 'temporary-error' as const, status: 500, reason: 'REST must not run', retryCount: 0 }))
  const getMarketplaceBlobsByNodeId = vi.fn(async () => ({
    kind: 'found' as const,
    data: [graphQLMarketplaceBlob(returnedNodeId, contentOid)],
    rateLimit: { cost: 2, remaining: 4_998, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 2 },
  }))
  const client = {
    ...reader(undefined, getMarketplace),
    getRepositoriesByNodeId: async () => ({
      kind: 'found' as const,
      data: [
        {
          ...githubRepo('team', 'repo'),
          node_id: returnedNodeId,
          marketplace_oid: metadataOid,
          marketplace_byte_size: 100,
          marketplace_is_binary: false,
        },
      ],
      rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
    }),
    getMarketplaceBlobsByNodeId,
  }

  const counts = await enrichRepositories(db, client, 'crawl-1')

  expect(counts).toMatchObject({ updated: 1, conclusive: 1, warnings: 0 })
  expect(getMarketplaceBlobsByNodeId).toHaveBeenCalledWith([requestedNodeId])
  expect(getMarketplace).not.toHaveBeenCalled()
  expect(db.prepare('SELECT plugins_count, marketplace_oid FROM repositories WHERE id = ?').get(id)).toEqual({
    plugins_count: validMarketplaceFixture.pluginsCount,
    marketplace_oid: contentOid,
  })
})

it('does not refetch an invalid GraphQL marketplace blob through REST and remembers its failed OID', async () => {
  const db = database()
  const nodeId = 'node-invalid-marketplace'
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old', new Date().toISOString(), nodeId)
  ready(db, id)
  const oldOid = 'a'.repeat(40)
  const currentOid = 'b'.repeat(40)
  db.prepare('UPDATE repositories SET marketplace_oid = ?, marketplace_parser_version = 1 WHERE id = ?').run(oldOid, id)
  const before = db.prepare('SELECT plugins_count FROM repositories WHERE id = ?').get(id)
  const getMarketplace = vi.fn(async () => ({ kind: 'found' as const, data: { plugins: [] } }))
  const getMarketplaceBlobsByNodeId = vi.fn(async () => ({
    kind: 'found' as const,
    data: [graphQLMarketplaceBlob(nodeId, currentOid, { text: '{"plugins":[' })],
    rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
  }))
  const client = {
    ...reader(undefined, getMarketplace),
    getRepositoriesByNodeId: async () => ({
      kind: 'found' as const,
      data: [
        {
          ...githubRepo('renamed-team', 'repo'),
          node_id: nodeId,
          marketplace_oid: currentOid,
          marketplace_byte_size: 100,
          marketplace_is_binary: false,
        },
      ],
      rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
    }),
    getMarketplaceBlobsByNodeId,
  }

  await enrichRepositories(db, client, 'crawl-1')
  await enrichRepositories(db, client, 'crawl-1')

  expect(getMarketplace).not.toHaveBeenCalled()
  expect(getMarketplaceBlobsByNodeId).toHaveBeenCalledTimes(1)
  expect(
    db
      .prepare(
        'SELECT html_url, owner, description, stargazers_count, plugins_count, marketplace_oid, marketplace_failed_oid, marketplace_failed_parser_version FROM repositories WHERE id = ?',
      )
      .get(id),
  ).toEqual({
    html_url: 'https://github.com/renamed-team/repo',
    owner: 'renamed-team',
    description: 'fresh',
    stargazers_count: 10,
    plugins_count: (before as { plugins_count: number }).plugins_count,
    marketplace_oid: oldOid,
    marketplace_failed_oid: currentOid,
    marketplace_failed_parser_version: MARKETPLACE_INVALID_CONTENT_CACHE_VERSION,
  })
  expect(listRunErrors(db, 'crawl-1').map(({ error_type, retry_count }) => ({ error_type, retry_count }))).toEqual([
    { error_type: 'marketplace_invalid_json', retry_count: 0 },
    { error_type: 'marketplace_known_invalid_content', retry_count: 0 },
  ])
})

it('keeps a newly discovered repository with invalid marketplace content out of publication across cached retries', async () => {
  const db = database()
  const nodeId = 'node-new-invalid-marketplace'
  const id = upsertDiscovery(db, 'https://github.com/team/new-invalid', 'discovered', new Date().toISOString(), nodeId)
  const currentOid = 'd'.repeat(40)
  const getMarketplace = vi.fn(async () => ({ kind: 'found' as const, data: { plugins: [] } }))
  const getMarketplaceBlobsByNodeId = vi.fn(async () => ({
    kind: 'found' as const,
    data: [graphQLMarketplaceBlob(nodeId, currentOid, { text: '{"plugins":[' })],
    rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
  }))
  const client = {
    ...reader(undefined, getMarketplace),
    getRepositoriesByNodeId: async () => ({
      kind: 'found' as const,
      data: [
        {
          ...githubRepo('team', 'new-invalid'),
          node_id: nodeId,
          marketplace_oid: currentOid,
          marketplace_byte_size: 100,
          marketplace_is_binary: false,
        },
      ],
      rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
    }),
    getMarketplaceBlobsByNodeId,
  }

  const first = await enrichRepositories(db, client, 'crawl-1')

  expect(first).toMatchObject({ newIncomplete: 1, newReady: 0, conclusive: 0 })
  expect(getMarketplace).not.toHaveBeenCalled()
  expect(listPublishable(db)).toEqual([])
  expect(
    db
      .prepare(
        'SELECT owner, owner_url, repo_name, marketplace_failed_oid, marketplace_failed_parser_version FROM repositories WHERE id = ?',
      )
      .get(id),
  ).toEqual({
    owner: null,
    owner_url: null,
    repo_name: null,
    marketplace_failed_oid: currentOid,
    marketplace_failed_parser_version: MARKETPLACE_INVALID_CONTENT_CACHE_VERSION,
  })

  const second = await enrichRepositories(db, client, 'crawl-1')

  expect(second).toMatchObject({ newIncomplete: 1, newReady: 0, conclusive: 0, knownInvalidSkipped: 1 })
  expect(getMarketplaceBlobsByNodeId).toHaveBeenCalledTimes(1)
  expect(getMarketplace).not.toHaveBeenCalled()
  expect(listPublishable(db)).toEqual([])
})

it('falls back to REST without negative-caching a stale metadata OID when the GraphQL blob OID changed', async () => {
  const db = database()
  const nodeId = 'node-marketplace-race'
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old', new Date().toISOString(), nodeId)
  ready(db, id)
  const oldOid = 'a'.repeat(40)
  const metadataOid = 'b'.repeat(40)
  const contentOid = 'c'.repeat(40)
  db.prepare('UPDATE repositories SET marketplace_oid = ?, marketplace_parser_version = 1 WHERE id = ?').run(oldOid, id)
  const getMarketplace = vi.fn(async () => ({ kind: 'found' as const, data: { plugins: [1, 2] } }))
  const client = {
    ...reader(undefined, getMarketplace),
    getRepositoriesByNodeId: async () => ({
      kind: 'found' as const,
      data: [
        {
          ...githubRepo('team', 'repo'),
          node_id: nodeId,
          marketplace_oid: metadataOid,
          marketplace_byte_size: 100,
          marketplace_is_binary: false,
        },
      ],
      rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
    }),
    getMarketplaceBlobsByNodeId: async () => ({
      kind: 'found' as const,
      data: [graphQLMarketplaceBlob(nodeId, contentOid, { text: '{"plugins":[' })],
      rateLimit: { cost: 1, remaining: 4_998, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 2 },
    }),
  }

  const counts = await enrichRepositories(db, client, 'crawl-1')

  expect(counts).toMatchObject({ updated: 1, conclusive: 1, warnings: 0 })
  expect(getMarketplace).toHaveBeenCalledOnce()
  expect(getMarketplace).toHaveBeenCalledWith('team', 'repo', undefined, { maxAttempts: 1 })
  expect(
    db
      .prepare(
        'SELECT plugins_count, marketplace_oid, marketplace_failed_oid, marketplace_failed_parser_version FROM repositories WHERE id = ?',
      )
      .get(id),
  ).toEqual({
    plugins_count: 2,
    marketplace_oid: oldOid,
    marketplace_failed_oid: null,
    marketplace_failed_parser_version: null,
  })
  expect(listRunErrors(db, 'crawl-1')).toEqual([])
})

it('defers retryable REST failures until the first repository pass is complete', async () => {
  const db = database()
  upsertDiscovery(db, 'https://github.com/team/first', null)
  upsertDiscovery(db, 'https://github.com/team/second', null)
  const calls: string[] = []
  let firstAttempts = 0
  const client: GitHubReader = {
    getPluginManifest: async () => ({ kind: 'not-found' }),
    searchRepositories: async () => {
      throw new Error('Repository search is unused in this fixture')
    },
    searchCode: async () => {
      throw new Error('enrichment must not search')
    },
    getRepository: async (owner, name, _etag, options) => {
      calls.push(`repo:${name}:max${options?.maxAttempts ?? 3}`)
      if (name === 'first' && firstAttempts++ === 0) {
        return {
          kind: 'temporary-error',
          status: 503,
          reason: 'GitHub server error',
          retryCount: 0,
          failureReason: 'server_5xx',
          retryable: true,
          retryAt: 30_000,
        }
      }
      return { kind: 'found', data: githubRepo(owner, name) }
    },
    getMarketplace: async (_owner, name, _etag, options) => {
      calls.push(`marketplace:${name}:max${options?.maxAttempts ?? 3}`)
      return { kind: 'found', data: { plugins: [] } }
    },
    waitUntil: async (timestampMs) => {
      calls.push(`wait-until:${timestampMs}`)
      return timestampMs
    },
    noteRetry: (_bucket, reason, waitMs) => {
      calls.push(`retry:${reason}:wait${waitMs ?? 0}`)
    },
  }

  const counts = await enrichRepositories(db, client, 'crawl-1')

  expect(counts).toMatchObject({ newReady: 2, conclusive: 2, unchangedOnError: 0, newIncomplete: 0 })
  expect(calls).toEqual([
    'repo:first:max1',
    'repo:second:max1',
    'marketplace:second:max1',
    'wait-until:30000',
    'retry:server_5xx:wait30000',
    'repo:first:max2',
    'marketplace:first:max3',
  ])
  expect(listRunErrors(db, 'crawl-1')).toEqual([])
  expect(getRun(db, 'crawl-1')).toMatchObject({ phase: 'enrichment', phase_total: 2, phase_processed: 2 })
})

it('gives marketplace a fresh three-attempt budget after a deferred repository retry succeeds', async () => {
  const db = database()
  upsertDiscovery(db, 'https://github.com/team/repo', null)
  let repositoryCalls = 0
  let marketplaceAttempts = 0
  const repositoryMaxAttempts: number[] = []
  const marketplaceMaxAttempts: number[] = []
  const client: GitHubReader = {
    getPluginManifest: async () => ({ kind: 'not-found' }),
    searchRepositories: async () => {
      throw new Error('Repository search is unused in this fixture')
    },
    searchCode: async () => {
      throw new Error('enrichment must not search')
    },
    getRepository: async (owner, name, _etag, options) => {
      repositoryMaxAttempts.push(options?.maxAttempts ?? 3)
      repositoryCalls++
      if (repositoryCalls === 1) {
        return {
          kind: 'temporary-error',
          status: 503,
          reason: 'GitHub server error',
          retryCount: 0,
          failureReason: 'server_5xx',
          retryable: true,
        }
      }
      return { kind: 'found', data: githubRepo(owner, name) }
    },
    getMarketplace: async (_owner, _name, _etag, options) => {
      const maxAttempts = options?.maxAttempts ?? 3
      marketplaceMaxAttempts.push(maxAttempts)
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        marketplaceAttempts++
        if (marketplaceAttempts === 3) return { kind: 'found', data: { plugins: [] } }
      }
      return {
        kind: 'temporary-error',
        status: 503,
        reason: 'GitHub server error',
        retryCount: maxAttempts - 1,
        failureReason: 'server_5xx',
        retryable: true,
      }
    },
  }

  const counts = await enrichRepositories(db, client, 'crawl-1')

  expect(repositoryMaxAttempts).toEqual([1, 2])
  expect(marketplaceMaxAttempts).toEqual([3])
  expect(marketplaceAttempts).toBe(3)
  expect(counts).toMatchObject({ newReady: 1, conclusive: 1, newIncomplete: 0, warnings: 0 })
  expect(listRunErrors(db, 'crawl-1')).toEqual([])
})

it('does not inherit the repository retry offset when marketplace content is immediately invalid', async () => {
  const db = database()
  upsertDiscovery(db, 'https://github.com/team/repo', null)
  let repositoryCalls = 0
  const marketplaceMaxAttempts: number[] = []
  const client: GitHubReader = {
    getPluginManifest: async () => ({ kind: 'not-found' }),
    searchRepositories: async () => {
      throw new Error('Repository search is unused in this fixture')
    },
    searchCode: async () => {
      throw new Error('enrichment must not search')
    },
    getRepository: async (owner, name) => {
      repositoryCalls++
      if (repositoryCalls === 1) {
        return {
          kind: 'temporary-error',
          status: 503,
          reason: 'GitHub server error',
          retryCount: 0,
          failureReason: 'server_5xx',
          retryable: true,
        }
      }
      return { kind: 'found', data: githubRepo(owner, name) }
    },
    getMarketplace: async (_owner, _name, _etag, options) => {
      marketplaceMaxAttempts.push(options?.maxAttempts ?? 3)
      return {
        kind: 'invalid-content',
        failure: 'invalid-manifest',
        status: 200,
        reason: 'Invalid marketplace manifest at plugins[0]',
        retryCount: 0,
        failureReason: 'invalid_manifest',
        retryable: false,
      }
    },
  }

  const counts = await enrichRepositories(db, client, 'crawl-1')

  expect(marketplaceMaxAttempts).toEqual([3])
  expect(counts).toMatchObject({ newIncomplete: 1, conclusive: 0, warnings: 1 })
  expect(listRunErrors(db, 'crawl-1').map(({ error_type, retry_count }) => ({ error_type, retry_count }))).toEqual([
    { error_type: 'marketplace_invalid_manifest', retry_count: 0 },
  ])
})

it('clears a stale REST ETag after accepting GraphQL marketplace content', async () => {
  const db = database()
  const nodeId = 'node-clear-etag'
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old', new Date().toISOString(), nodeId)
  ready(db, id)
  db.prepare('UPDATE repositories SET marketplace_oid = ?, marketplace_etag = ?, marketplace_parser_version = 1 WHERE id = ?').run(
    'old-oid',
    '"stale-rest-etag"',
    id,
  )
  const contentOid = 'content-oid'
  const client = {
    ...reader(),
    getRepositoriesByNodeId: async () => ({
      kind: 'found' as const,
      data: [
        {
          ...githubRepo('team', 'repo'),
          node_id: nodeId,
          marketplace_oid: contentOid,
          marketplace_byte_size: 100,
          marketplace_is_binary: false,
        },
      ],
      rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
    }),
    getMarketplaceBlobsByNodeId: async () => ({
      kind: 'found' as const,
      data: [graphQLMarketplaceBlob(nodeId, contentOid)],
      rateLimit: { cost: 1, remaining: 4_998, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 2 },
    }),
  }

  await enrichRepositories(db, client, 'crawl-1')

  expect(db.prepare('SELECT marketplace_oid, marketplace_etag FROM repositories WHERE id = ?').get(id)).toEqual({
    marketplace_oid: contentOid,
    marketplace_etag: null,
  })
})

it('publishes bounded plugin summaries without splitting or preserving malformed surrogate pairs', async () => {
  const db = database()
  const nodeId = 'node-unicode-marketplace'
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old', new Date().toISOString(), nodeId)
  const oid = 'unicode-marketplace-oid'
  const astral = String.fromCodePoint(0x1f600)
  const pluginName = `${'n'.repeat(158)}${astral}`
  const pluginDescription = `${'d'.repeat(298)}${astral}${'x'.repeat(5)}`
  const manifest = {
    name: 'catalog',
    owner: { name: 'maintainer' },
    plugins: [
      {
        name: `${'n'.repeat(161)}`,
        displayName: `${pluginName}${'x'.repeat(5)}`,
        description: pluginDescription,
        source: './plugins/invalid-overlong-name',
      },
      { name: 'demo-plugin', displayName: pluginName, description: pluginDescription, source: './plugins/demo' },
      { name: 'malformed-plugin', displayName: '\ud800bad\udc00', description: '\udc00bad\ud800', source: './plugins/malformed' },
    ],
  }
  const text = JSON.stringify(manifest)
  const client = {
    ...reader(),
    getRepositoriesByNodeId: async () => ({
      kind: 'found' as const,
      data: [
        {
          ...githubRepo('team', 'repo'),
          node_id: nodeId,
          marketplace_oid: oid,
          marketplace_byte_size: text.length,
          marketplace_is_binary: false,
        },
      ],
      rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
    }),
    getMarketplaceBlobsByNodeId: async () => ({
      kind: 'found' as const,
      data: [graphQLMarketplaceBlob(nodeId, oid, { text })],
      rateLimit: { cost: 1, remaining: 4_998, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 2 },
    }),
  }

  const counts = await enrichRepositories(db, client, 'crawl-1')
  const published = listPublishable(db).find((repository) => repository.id === id)

  expect(counts).toMatchObject({ newReady: 1, conclusive: 1, warnings: 0 })
  expect(published?.plugins_json).toBe(
    JSON.stringify([
      { name: `${'n'.repeat(158)}${astral}`, description: `${'d'.repeat(298)}${astral}` },
      { name: '\ufffdbad\ufffd', description: '\ufffdbad\ufffd' },
    ]),
  )
  expect(JSON.parse(published?.plugins_json ?? '[]')).toHaveLength(2)
  expect(published?.plugins_json).not.toContain('\\ud800')
  expect(published?.plugins_json).not.toContain('\\udc00')
})

it('fully indexes marketplace repositories with more than 30 plugins up to 500 into SQLite', async () => {
  const db = database()
  const nodeId = 'node-large-marketplace'
  const id = upsertDiscovery(db, 'https://github.com/team/large-repo', 'old', new Date().toISOString(), nodeId)
  const oid = 'large-marketplace-oid'
  const plugins = Array.from({ length: 75 }, (_, index) => ({
    name: `plugin-${index + 1}`,
    description: `Description for plugin ${index + 1}`,
    source: `./plugins/plugin-${index + 1}`,
  }))
  const manifest = {
    name: 'large-catalog',
    owner: { name: 'maintainer' },
    plugins,
  }
  const text = JSON.stringify(manifest)
  const client = {
    ...reader(),
    getRepositoriesByNodeId: async () => ({
      kind: 'found' as const,
      data: [
        {
          ...githubRepo('team', 'large-repo'),
          node_id: nodeId,
          marketplace_oid: oid,
          marketplace_byte_size: text.length,
          marketplace_is_binary: false,
        },
      ],
      rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
    }),
    getMarketplaceBlobsByNodeId: async () => ({
      kind: 'found' as const,
      data: [graphQLMarketplaceBlob(nodeId, oid, { text })],
      rateLimit: { cost: 1, remaining: 4_998, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 2 },
    }),
  }

  const counts = await enrichRepositories(db, client, 'crawl-1')
  const published = listPublishable(db).find((repository) => repository.id === id)

  expect(counts).toMatchObject({ newReady: 1, conclusive: 1, warnings: 0 })
  expect(published?.plugins_count).toBe(75)
  const parsed = JSON.parse(published?.plugins_json ?? '[]')
  expect(parsed).toHaveLength(75)
  expect(parsed[0].name).toBe('plugin-1')
  expect(parsed[30].name).toBe('plugin-31')
  expect(parsed[74].name).toBe('plugin-75')
})

it('recrawls and republishes cached large-marketplace summaries after upgrading SQLite v19 to v20', async () => {
  const db = database()
  const nodeId = 'node-migrated-large-marketplace'
  const id = upsertDiscovery(db, 'https://github.com/team/large-repo', 'cached', new Date().toISOString(), nodeId)
  ready(db, id, 'team', 'large-repo')
  const oid = 'unchanged-marketplace-oid'
  const plugins = Array.from({ length: 75 }, (_, index) => ({
    name: `plugin-${index + 1}`,
    description: `Unique plugin description ${index + 1}`,
    source: `./plugins/plugin-${index + 1}`,
  }))
  const oldSummaries = plugins.slice(0, 30).map(({ name, description }) => ({ name, description }))
  db.prepare(`
    UPDATE repositories
    SET plugins_count = ?, plugins_json = ?, marketplace_oid = ?, marketplace_etag = ?, marketplace_parser_version = ?
    WHERE id = ?
  `).run(75, JSON.stringify(oldSummaries), oid, '"cached"', MARKETPLACE_PARSER_VERSION, id)

  db.pragma('user_version = 19')
  initializeSchema(db)
  expect(db.prepare('SELECT marketplace_oid, marketplace_etag FROM repositories WHERE id = ?').get(id)).toEqual({
    marketplace_oid: null,
    marketplace_etag: null,
  })

  const text = JSON.stringify({ name: 'large-catalog', owner: { name: 'maintainer' }, plugins })
  const getMarketplaceBlobsByNodeId = vi.fn(async () => ({
    kind: 'found' as const,
    data: [graphQLMarketplaceBlob(nodeId, oid, { text })],
    rateLimit: { cost: 1, remaining: 4_998, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 2 },
  }))
  const client = {
    ...reader(),
    getRepositoriesByNodeId: async () => ({
      kind: 'found' as const,
      data: [
        {
          ...githubRepo('team', 'large-repo'),
          node_id: nodeId,
          marketplace_oid: oid,
          marketplace_byte_size: text.length,
          marketplace_is_binary: false,
        },
      ],
      rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
    }),
    getMarketplaceBlobsByNodeId,
  }

  const counts = await enrichRepositories(db, client, 'crawl-1')
  expect(counts).toMatchObject({ updated: 1, conclusive: 1, warnings: 0 })
  expect(getMarketplaceBlobsByNodeId).toHaveBeenCalledTimes(1)
  const published = JSON.parse(renderRepos(listPublishable(db))) as Array<{
    id: number
    plugins_count: number
    plugins?: Array<{ name?: string }>
  }>
  const large = published.find((repo) => repo.id === id)
  expect(large?.plugins_count).toBe(75)
  expect(large?.plugins).toHaveLength(75)
  expect(large?.plugins?.[30]?.name).toBe('plugin-31')
  expect(large?.plugins?.[74]?.name).toBe('plugin-75')
})

it.each([
  ['malformed JSON', '{"plugins":['],
  ['old unmatched surrogate', JSON.stringify([{ description: `old${'\ud800'}` }])],
  ['oversized summary', JSON.stringify([{ description: 'd'.repeat(301) }])],
  ['wrong summary shape', JSON.stringify([{ name: 42 }])],
])('refreshes invalid cached plugin summaries after an unexpected 304 (%s)', async (_label, cachedSummary) => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old')
  ready(db, id)
  db.prepare('UPDATE repositories SET plugins_json = ?, marketplace_etag = ? WHERE id = ?').run(cachedSummary, '"stale"', id)
  const getMarketplace = vi
    .fn()
    .mockResolvedValueOnce({ kind: 'not-modified' as const, etag: '"still-stale"' })
    .mockResolvedValueOnce({
      kind: 'found' as const,
      data: { plugins: [{ name: 'repaired-plugin', description: 'Fresh summary' }] },
      etag: '"fresh"',
    })
  const client = reader(undefined, getMarketplace)

  const firstCounts = await enrichRepositories(db, client, 'crawl-1')
  const firstSnapshot = renderRepos(listPublishable(db))
  expect(getMarketplace).toHaveBeenNthCalledWith(1, 'team', 'repo', undefined, { maxAttempts: 1 })
  expect(firstCounts).toMatchObject({ unchangedOnError: 1, warnings: 0 })
  expect(JSON.parse(firstSnapshot)[0]).not.toHaveProperty('plugins')

  await enrichRepositories(db, client, 'crawl-1')
  expect(getMarketplace).toHaveBeenNthCalledWith(2, 'team', 'repo', undefined, { maxAttempts: 1 })
  expect(JSON.parse(renderRepos(listPublishable(db)))[0].plugins).toEqual([{ name: 'repaired-plugin', description: 'Fresh summary' }])
})

it('refreshes invalid summaries on an unchanged GraphQL OID and repairs the published value', async () => {
  const db = database()
  const nodeId = 'node-invalid-cached-summary'
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old', new Date().toISOString(), nodeId)
  ready(db, id)
  const oid = 'same-marketplace-oid'
  db.prepare('UPDATE repositories SET marketplace_oid = ?, plugins_json = ? WHERE id = ?').run(
    oid,
    JSON.stringify([{ description: `old${'\ud800'}` }]),
    id,
  )
  const blobText = JSON.stringify({
    name: 'catalog',
    owner: { name: 'maintainer' },
    plugins: [{ name: 'fresh-plugin', source: './plugins/fresh', description: 'Valid again' }],
  })
  const getMarketplaceBlobsByNodeId = vi.fn(async () => ({
    kind: 'found' as const,
    data: [graphQLMarketplaceBlob(nodeId, oid, { text: blobText })],
    rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
  }))
  const getMarketplace = vi.fn(async () => ({
    kind: 'temporary-error' as const,
    status: 500,
    reason: 'GraphQL should repair cache',
    retryCount: 0,
  }))
  const client = {
    ...reader(undefined, getMarketplace),
    getRepositoriesByNodeId: async () => ({
      kind: 'found' as const,
      data: [
        {
          ...githubRepo('team', 'repo'),
          node_id: nodeId,
          marketplace_oid: oid,
          marketplace_byte_size: blobText.length,
          marketplace_is_binary: false,
        },
      ],
      rateLimit: { cost: 1, remaining: 5_000, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 0 },
    }),
    getMarketplaceBlobsByNodeId,
  }

  await enrichRepositories(db, client, 'crawl-1')

  expect(getMarketplaceBlobsByNodeId).toHaveBeenCalledWith([nodeId])
  expect(getMarketplace).not.toHaveBeenCalled()
  expect(JSON.parse(renderRepos(listPublishable(db)))[0].plugins).toEqual([{ name: 'fresh-plugin', description: 'Valid again' }])
})

it('rechecks a successful cached count when its parser version is stale', async () => {
  const db = database()
  const nodeId = 'MDEwOlJlcG9zaXRvcnky'
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old', new Date().toISOString(), nodeId)
  ready(db, id)
  const oid = 'a'.repeat(40)
  db.prepare('UPDATE repositories SET marketplace_oid = ?, marketplace_parser_version = 2 WHERE id = ?').run(oid, id)
  const getMarketplace = vi.fn(async () => ({ kind: 'temporary-error' as const, status: 500, reason: 'REST must not run', retryCount: 0 }))
  const getMarketplaceBlobsByNodeId = vi.fn(async () => ({
    kind: 'found' as const,
    data: [graphQLMarketplaceBlob(nodeId, oid)],
    rateLimit: { cost: 2, remaining: 4_998, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 2 },
  }))
  const client = {
    ...reader(undefined, getMarketplace),
    getRepositoriesByNodeId: async () => ({
      kind: 'found' as const,
      data: [
        {
          ...githubRepo('team', 'repo'),
          node_id: nodeId,
          marketplace_oid: oid,
          marketplace_byte_size: 100,
          marketplace_is_binary: false,
        },
      ],
      rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
    }),
    getMarketplaceBlobsByNodeId,
  }

  await enrichRepositories(db, client, 'crawl-1')

  expect(getMarketplaceBlobsByNodeId).toHaveBeenCalledWith([nodeId])
  expect(getMarketplace).not.toHaveBeenCalled()
  expect(db.prepare('SELECT plugins_count, marketplace_parser_version FROM repositories WHERE id = ?').get(id)).toEqual({
    plugins_count: validMarketplaceFixture.pluginsCount,
    marketplace_parser_version: MARKETPLACE_PARSER_VERSION,
  })
})

it('uses one GraphQL content request for 25 changed marketplaces', async () => {
  const db = database()
  const nodeIds: string[] = []
  const repositories: GitHubGraphQLRepo[] = []
  const blobs: GitHubGraphQLMarketplaceBlob[] = []
  for (let index = 1; index <= 25; index++) {
    const repoName = `repo${index}`
    const nodeId = `node-${index}`
    const id = upsertDiscovery(db, `https://github.com/team/${repoName}`, 'old', new Date().toISOString(), nodeId)
    ready(db, id, 'team', repoName)
    db.prepare('UPDATE repositories SET marketplace_oid = ?, marketplace_parser_version = 1 WHERE id = ?').run(`old-${index}`, id)
    nodeIds.push(nodeId)
    const oid = `new-${index}`
    repositories.push({
      ...githubRepo('team', repoName),
      node_id: nodeId,
      marketplace_oid: oid,
      marketplace_byte_size: 100,
      marketplace_is_binary: false,
    })
    blobs.push(graphQLMarketplaceBlob(nodeId, oid))
  }
  const getMarketplace = vi.fn(async () => ({ kind: 'temporary-error' as const, status: 500, reason: 'REST must not run', retryCount: 0 }))
  const getRepositoriesByNodeId = vi.fn(async () => ({
    kind: 'found' as const,
    data: repositories,
    rateLimit: { cost: 10, remaining: 4_990, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 10 },
  }))
  const getMarketplaceBlobsByNodeId = vi.fn(async () => ({
    kind: 'found' as const,
    data: blobs,
    rateLimit: { cost: 10, remaining: 4_980, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 20 },
  }))
  const client = { ...reader(undefined, getMarketplace), getRepositoriesByNodeId, getMarketplaceBlobsByNodeId }

  const counts = await enrichRepositories(db, client, 'crawl-1')

  expect(counts).toMatchObject({ updated: 25, conclusive: 25, warnings: 0 })
  expect(getRepositoriesByNodeId).toHaveBeenCalledTimes(1)
  expect(getMarketplaceBlobsByNodeId).toHaveBeenCalledTimes(1)
  expect(getMarketplaceBlobsByNodeId).toHaveBeenCalledWith(nodeIds)
  expect(getMarketplace).not.toHaveBeenCalled()
})

it('falls back to REST only for an unusable blob inside a successful content batch', async () => {
  const db = database()
  const rows = [
    { repo: 'repo1', nodeId: 'node-1', oldOid: 'old-1', newOid: 'new-1' },
    { repo: 'repo2', nodeId: 'node-2', oldOid: 'old-2', newOid: 'new-2' },
  ]
  for (const row of rows) {
    const id = upsertDiscovery(db, `https://github.com/team/${row.repo}`, 'old', new Date().toISOString(), row.nodeId)
    ready(db, id, 'team', row.repo)
    db.prepare('UPDATE repositories SET marketplace_oid = ?, marketplace_parser_version = 1 WHERE id = ?').run(row.oldOid, id)
  }
  const getMarketplace = vi.fn(async () => ({ kind: 'found' as const, data: { plugins: [1, 2] } }))
  const client = {
    ...reader(undefined, getMarketplace),
    getRepositoriesByNodeId: async () => ({
      kind: 'found' as const,
      data: rows.map((row) => ({
        ...githubRepo('team', row.repo),
        node_id: row.nodeId,
        marketplace_oid: row.newOid,
        marketplace_byte_size: 100,
        marketplace_is_binary: false,
      })),
      rateLimit: { cost: 2, remaining: 4_998, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 2 },
    }),
    getMarketplaceBlobsByNodeId: async () => ({
      kind: 'found' as const,
      data: [
        graphQLMarketplaceBlob(rows[0].nodeId, rows[0].newOid),
        graphQLMarketplaceBlob(rows[1].nodeId, rows[1].newOid, { is_truncated: true }),
      ],
      rateLimit: { cost: 2, remaining: 4_996, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 4 },
    }),
  }

  const counts = await enrichRepositories(db, client, 'crawl-1')

  expect(counts).toMatchObject({ updated: 2, conclusive: 2, warnings: 0 })
  expect(getMarketplace).toHaveBeenCalledTimes(1)
  expect(getMarketplace).toHaveBeenCalledWith('team', 'repo2', undefined, { maxAttempts: 1 })
  expect(
    db.prepare('SELECT repo_name, plugins_count FROM repositories WHERE repo_name IN (?, ?) ORDER BY repo_name').all('repo1', 'repo2'),
  ).toEqual([
    { repo_name: 'repo1', plugins_count: validMarketplaceFixture.pluginsCount },
    { repo_name: 'repo2', plugins_count: 2 },
  ])
})

it('uses REST when GitHub cannot determine whether the marketplace blob is binary', async () => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old', new Date().toISOString(), 'node-one')
  ready(db, id)
  db.prepare('UPDATE repositories SET marketplace_oid = ?, marketplace_parser_version = 1 WHERE id = ?').run('a'.repeat(40), id)

  const getMarketplace = vi.fn(async () => ({ kind: 'found' as const, data: { plugins: [] } }))
  const getMarketplaceBlobsByNodeId = vi.fn(async () => {
    throw new Error('indeterminate encodings should bypass GraphQL text batching')
  })
  const client = {
    ...reader(undefined, getMarketplace),
    getRepositoriesByNodeId: async () => ({
      kind: 'found' as const,
      data: [
        {
          ...githubRepo('team', 'repo'),
          node_id: 'node-one',
          marketplace_oid: 'b'.repeat(40),
          marketplace_byte_size: 100,
          marketplace_is_binary: null,
        },
      ],
      rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
    }),
    getMarketplaceBlobsByNodeId,
  }

  await enrichRepositories(db, client, 'crawl-1')

  expect(getMarketplaceBlobsByNodeId).not.toHaveBeenCalled()
  expect(getMarketplace).toHaveBeenCalledWith('team', 'repo', undefined, { maxAttempts: 1 })
})

it('splits marketplace GraphQL batches before their estimated blob payload exceeds the safety cap', async () => {
  const db = database()
  const ids = ['one', 'two'].map((name, index) =>
    upsertDiscovery(db, `https://github.com/team/${name}`, 'old', new Date().toISOString(), `node-${index + 1}`),
  )
  const [firstId, secondId] = ids
  if (firstId === undefined || secondId === undefined) throw new Error('Expected fixtures')
  ready(db, firstId, 'team', 'one')
  ready(db, secondId, 'team', 'two')
  db.prepare('UPDATE repositories SET marketplace_oid = ?, marketplace_parser_version = 1 WHERE id IN (?, ?)').run(
    'a'.repeat(40),
    firstId,
    secondId,
  )

  const metadata: GitHubGraphQLRepo[] = [
    {
      ...githubRepo('team', 'one'),
      node_id: 'node-1',
      marketplace_oid: 'b'.repeat(40),
      marketplace_byte_size: 600_000,
      marketplace_is_binary: false,
    },
    {
      ...githubRepo('team', 'two'),
      node_id: 'node-2',
      marketplace_oid: 'c'.repeat(40),
      marketplace_byte_size: 200_000,
      marketplace_is_binary: false,
    },
  ]
  const getMarketplaceBlobsByNodeId = vi.fn(async (nodeIds: readonly string[]) => ({
    kind: 'found' as const,
    data: nodeIds.map((nodeId) => graphQLMarketplaceBlob(nodeId, nodeId === 'node-1' ? 'b'.repeat(40) : 'c'.repeat(40))),
    rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
  }))
  const client = {
    ...reader(),
    getRepositoriesByNodeId: async () => ({
      kind: 'found' as const,
      data: metadata,
      rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
    }),
    getMarketplaceBlobsByNodeId,
  }

  await enrichRepositories(db, client, 'crawl-1')

  expect(getMarketplaceBlobsByNodeId).toHaveBeenCalledTimes(2)
  expect(getMarketplaceBlobsByNodeId.mock.calls.map(([nodeIds]) => nodeIds)).toEqual([['node-1'], ['node-2']])
})

it('splits a timed-out marketplace GraphQL batch before falling back to REST', async () => {
  const db = database()
  const firstId = upsertDiscovery(db, 'https://github.com/team/one', 'old', new Date().toISOString(), 'node-one')
  const secondId = upsertDiscovery(db, 'https://github.com/team/two', 'old', new Date().toISOString(), 'node-two')
  ready(db, firstId, 'team', 'one')
  ready(db, secondId, 'team', 'two')
  db.prepare('UPDATE repositories SET marketplace_oid = ?, marketplace_parser_version = 1 WHERE id IN (?, ?)').run(
    'a'.repeat(40),
    firstId,
    secondId,
  )

  const metadata: GitHubGraphQLRepo[] = [
    {
      ...githubRepo('team', 'one'),
      node_id: 'node-one',
      marketplace_oid: 'b'.repeat(40),
      marketplace_byte_size: 100,
      marketplace_is_binary: false,
    },
    {
      ...githubRepo('team', 'two'),
      node_id: 'node-two',
      marketplace_oid: 'c'.repeat(40),
      marketplace_byte_size: 100,
      marketplace_is_binary: false,
    },
  ]
  const getMarketplace = vi.fn(async () => {
    throw new Error('REST marketplace should not be used after a successful split retry')
  })
  const getMarketplaceBlobsByNodeId = vi.fn(async (nodeIds: readonly string[]) => {
    if (nodeIds.length > 1) return { kind: 'temporary-error' as const, status: null, reason: 'GitHub GraphQL timeout' }
    const nodeId = nodeIds[0]
    if (!nodeId) throw new Error('Expected node ID')
    return {
      kind: 'found' as const,
      data: [graphQLMarketplaceBlob(nodeId, nodeId === 'node-one' ? 'b'.repeat(40) : 'c'.repeat(40))],
      rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
    }
  })
  const noteRetry = vi.fn()
  const client = {
    ...reader(undefined, getMarketplace),
    getRepositoriesByNodeId: async () => ({
      kind: 'found' as const,
      data: metadata,
      rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
    }),
    getMarketplaceBlobsByNodeId,
    noteRetry,
  }

  const counts = await enrichRepositories(db, client, 'crawl-1')

  expect(counts).toMatchObject({ updated: 2, conclusive: 2, warnings: 0 })
  expect(getMarketplaceBlobsByNodeId.mock.calls.map(([nodeIds]) => nodeIds)).toEqual([['node-one', 'node-two'], ['node-one'], ['node-two']])
  expect(noteRetry).toHaveBeenCalledTimes(1)
  expect(noteRetry).toHaveBeenCalledWith('graphql', 'graphql_timeout')
  expect(getMarketplace).not.toHaveBeenCalled()
})

it('recovers a failed metadata batch without losing marketplace content batching', async () => {
  const db = database()
  const rows = Array.from({ length: 11 }, (_, index) => {
    const name = `repo-${index}`
    const nodeId = `node-${index}`
    const id = upsertDiscovery(db, `https://github.com/team/${name}`, 'old', new Date().toISOString(), nodeId)
    ready(db, id, 'team', name)
    db.prepare('UPDATE repositories SET marketplace_oid = ?, marketplace_parser_version = 1 WHERE id = ?').run('a'.repeat(40), id)
    return { name, nodeId }
  })

  let metadataCalls = 0
  const getRepositoriesByNodeId = vi.fn(async (nodeIds: readonly string[]) => {
    metadataCalls++
    if (metadataCalls === 1) return { kind: 'temporary-error' as const, status: 503, reason: 'temporary' }
    return {
      kind: 'found' as const,
      data: nodeIds.map((nodeId) => {
        const fixture = rows.find((row) => row.nodeId === nodeId)
        if (!fixture) return null
        return {
          ...githubRepo('team', fixture.name),
          node_id: nodeId,
          marketplace_oid: 'b'.repeat(40),
          marketplace_byte_size: 100,
          marketplace_is_binary: false,
        }
      }),
      rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
    }
  })
  const getMarketplaceBlobsByNodeId = vi.fn(async (nodeIds: readonly string[]) => ({
    kind: 'found' as const,
    data: nodeIds.map((nodeId) => graphQLMarketplaceBlob(nodeId, 'b'.repeat(40))),
    rateLimit: { cost: 1, remaining: 4_998, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 2 },
  }))
  const getMarketplace = vi.fn(async () => {
    throw new Error('REST marketplace should not be used after recovered GraphQL metadata batches')
  })
  const noteRetry = vi.fn()
  const client = {
    ...reader(undefined, getMarketplace),
    getRepositoriesByNodeId,
    getMarketplaceBlobsByNodeId,
    noteRetry,
  }

  const counts = await enrichRepositories(db, client, 'crawl-1')

  expect(counts).toMatchObject({ updated: 11, conclusive: 11, warnings: 0 })
  expect(noteRetry).toHaveBeenCalledTimes(1)
  expect(noteRetry).toHaveBeenCalledWith('graphql', 'server_5xx')
  expect(getRepositoriesByNodeId.mock.calls.map(([nodeIds]) => nodeIds.length)).toEqual([11, 10, 1])
  expect(getMarketplaceBlobsByNodeId.mock.calls.map(([nodeIds]) => nodeIds.length)).toEqual([10, 1])
  expect(getMarketplace).not.toHaveBeenCalled()
})

it('reuses cached repository metadata after a conditional REST 304', async () => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old')
  ready(db, id)
  // The repository already has archived metadata, so its conditional ETag remains valid.
  db.prepare('UPDATE repositories SET archived = 0 WHERE id = ?').run(id)
  db.prepare('UPDATE repositories SET repository_etag = ?, marketplace_etag = ?, marketplace_parser_version = ? WHERE id = ?').run(
    '"repo"',
    '"manifest"',
    MARKETPLACE_PARSER_VERSION,
    id,
  )
  const getRepository = vi.fn(async () => ({ kind: 'not-modified' as const, etag: '"repo"' }))
  const getMarketplace = vi.fn(async () => ({ kind: 'not-modified' as const, etag: '"manifest"' }))

  const counts = await enrichRepositories(db, reader(getRepository, getMarketplace), 'crawl-1')

  expect(getRepository).toHaveBeenCalledWith('team', 'repo', '"repo"', { maxAttempts: 1 })
  expect(getMarketplace).toHaveBeenCalledWith('team', 'repo', '"manifest"', { maxAttempts: 1 })
  expect(counts).toMatchObject({ updated: 1, conclusive: 1, warnings: 0, unchangedOnError: 0 })
  expect(db.prepare('SELECT id FROM repositories WHERE id = ?').get(id)).toEqual({ id })
})

it('does not mark a stale legacy marketplace count as refreshed after an unexpected REST 304', async () => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old')
  ready(db, id)
  db.prepare('UPDATE repositories SET marketplace_etag = ?, marketplace_parser_version = 1 WHERE id = ?').run('"old"', id)
  const getMarketplace = vi.fn(async () => ({ kind: 'not-modified' as const, etag: '"old"' }))

  const counts = await enrichRepositories(db, reader(undefined, getMarketplace), 'crawl-1')

  expect(getMarketplace).toHaveBeenCalledWith('team', 'repo', undefined, { maxAttempts: 1 })
  expect(counts).toMatchObject({ updated: 0, unchangedOnError: 1, warnings: 0, conclusive: 0 })
  expect(db.prepare('SELECT plugins_count, marketplace_parser_version FROM repositories WHERE id = ?').get(id)).toEqual({
    plugins_count: 3,
    marketplace_parser_version: 1,
  })
  expect(listRunErrors(db, 'crawl-1').map(({ error_type }) => error_type)).toContain('marketplace_not_modified_with_stale_parser')
})

it('backfills a legacy row node ID through REST for GraphQL on the next crawl', async () => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old')
  const legacyRepository = { ...githubRepo('team', 'repo'), node_id: 'MDEwOlJlcG9zaXRvcnkx' }
  const client = reader(
    async () => ({ kind: 'found', data: legacyRepository, etag: '"repo"' }),
    async () => ({ kind: 'found', data: { plugins: [1] }, etag: '"manifest"' }),
  )

  await enrichRepositories(db, client, 'crawl-1')

  expect(
    db.prepare('SELECT github_node_id, marketplace_oid, repository_etag, marketplace_etag FROM repositories WHERE id = ?').get(id),
  ).toEqual({
    github_node_id: 'MDEwOlJlcG9zaXRvcnkx',
    marketplace_oid: null,
    repository_etag: '"repo"',
    marketplace_etag: '"manifest"',
  })
})

it('falls back to REST instead of deleting a repository when a GraphQL node lookup returns null', async () => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old', new Date().toISOString(), 'legacy-node-id')
  ready(db, id)
  const getRepository = vi.fn(async () => ({
    kind: 'found' as const,
    data: { ...githubRepo('team', 'repo'), node_id: 'new-node-id' },
  }))
  const getMarketplace = vi.fn(async () => ({ kind: 'found' as const, data: { plugins: [1] } }))
  const client = {
    ...reader(getRepository, getMarketplace),
    getRepositoriesByNodeId: async () => ({
      kind: 'found' as const,
      data: [null],
      rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
    }),
  }

  const counts = await enrichRepositories(db, client, 'crawl-1')

  expect(counts).toMatchObject({ deleted404: 0, updated: 1, conclusive: 1, warnings: 0 })
  expect(getRepository).toHaveBeenCalledWith('team', 'repo', undefined, { maxAttempts: 1 })
  expect(db.prepare('SELECT github_node_id FROM repositories WHERE id = ?').get(id)).toEqual({ github_node_id: 'new-node-id' })
})

it('preserves a repository when a null GraphQL node cannot be confirmed missing by REST', async () => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old', new Date().toISOString(), 'legacy-node-id')
  ready(db, id)
  const before = db.prepare('SELECT * FROM repositories WHERE id = ?').get(id)
  const getRepository = vi.fn(async () => ({
    kind: 'temporary-error' as const,
    status: 503,
    reason: 'temporary',
    retryCount: 3,
  }))
  const client = {
    ...reader(getRepository),
    getRepositoriesByNodeId: async () => ({
      kind: 'found' as const,
      data: [null],
      rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
    }),
  }

  const counts = await enrichRepositories(db, client, 'crawl-1')

  expect(counts).toMatchObject({ deleted404: 0, unchangedOnError: 1, conclusive: 0 })
  expect(db.prepare('SELECT * FROM repositories WHERE id = ?').get(id)).toEqual(before)
  expect(listRunErrors(db, 'crawl-1').map(({ error_type }) => error_type)).toEqual(['repository_temporary_error'])
})

it.each(['found', 'temporary-error'] as const)(
  'does not delete a repository when GraphQL has no marketplace OID and REST returns %s',
  async (kind) => {
    const db = database()
    const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old', new Date().toISOString(), 'legacy-node-id')
    ready(db, id)
    const getMarketplace = vi.fn(
      async (): Promise<RepoResult<Marketplace>> =>
        kind === 'found'
          ? { kind: 'found', data: { plugins: [1, 2] } }
          : { kind: 'temporary-error', status: 503, reason: 'temporary', retryCount: 0 },
    )
    const client = {
      ...reader(undefined, getMarketplace),
      getRepositoriesByNodeId: async () => ({
        kind: 'found' as const,
        data: [{ ...githubRepo('team', 'repo'), node_id: 'legacy-node-id', marketplace_oid: null }],
        rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
      }),
    }

    const counts = await enrichRepositories(db, client, 'crawl-1')

    expect(getMarketplace).toHaveBeenCalledWith('team', 'repo', undefined, { maxAttempts: 1 })
    expect(db.prepare('SELECT id FROM repositories WHERE id = ?').get(id)).toEqual({ id })
    expect(counts.deleted404).toBe(0)
    if (kind === 'found') expect(counts.updated).toBe(1)
    else expect(counts.unchangedOnError).toBe(1)
  },
)

it('deletes a repository only when REST confirms a null GraphQL marketplace OID is a 404', async () => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old', new Date().toISOString(), 'legacy-node-id')
  ready(db, id)
  const client = {
    ...reader(undefined, async () => ({ kind: 'not-found' as const })),
    getRepositoriesByNodeId: async () => ({
      kind: 'found' as const,
      data: [{ ...githubRepo('team', 'repo'), node_id: 'legacy-node-id', marketplace_oid: null }],
      rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
    }),
  }

  const counts = await enrichRepositories(db, client, 'crawl-1')

  expect(counts).toMatchObject({ deleted404: 1, conclusive: 1 })
  expect(db.prepare('SELECT id FROM repositories WHERE id = ?').get(id)).toBeUndefined()
  expect(db.prepare('SELECT html_url, github_node_id FROM rejected_repository_candidates').all()).toEqual([
    { html_url: 'https://github.com/team/repo', github_node_id: 'legacy-node-id' },
  ])
})

it('heartbeats immediately before a GraphQL marketplace REST fetch', async () => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old', new Date().toISOString(), 'MDEwOlJlcG9zaXRvcnkx')
  ready(db, id)
  db.prepare('UPDATE repositories SET marketplace_oid = ? WHERE id = ?').run('a'.repeat(40), id)
  const onProgress = vi.fn()
  const getMarketplace = vi.fn(async () => {
    expect(onProgress).toHaveBeenCalledTimes(2)
    return { kind: 'found' as const, data: { plugins: [1] } }
  })
  const client = {
    ...reader(undefined, getMarketplace),
    getRepositoriesByNodeId: async () => ({
      kind: 'found' as const,
      data: [{ ...githubRepo('team', 'repo'), node_id: 'MDEwOlJlcG9zaXRvcnkx', marketplace_oid: 'b'.repeat(40) }],
      rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
    }),
  }

  await enrichRepositories(db, client, 'crawl-1', onProgress)

  expect(getMarketplace).toHaveBeenCalledOnce()
})

it('falls back to per-repository REST when a small GraphQL batch fails', async () => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old', new Date().toISOString(), 'MDEwOlJlcG9zaXRvcnkx')
  ready(db, id)
  const getRepository = vi.fn(async () => ({
    kind: 'found' as const,
    data: { ...githubRepo('team', 'repo'), node_id: 'MDEwOlJlcG9zaXRvcnkx' },
  }))
  const getMarketplace = vi.fn(async () => ({ kind: 'found' as const, data: { plugins: [1, 2] } }))
  const client = {
    ...reader(getRepository, getMarketplace),
    getRepositoriesByNodeId: async () => ({ kind: 'temporary-error' as const, status: 503, reason: 'temporary' }),
  }

  const counts = await enrichRepositories(db, client, 'crawl-1')

  expect(counts).toMatchObject({ updated: 1, unchangedOnError: 0, warnings: 0, conclusive: 1 })
  expect(getRepository).toHaveBeenCalledWith('team', 'repo', undefined, { maxAttempts: 1 })
  expect(getMarketplace).toHaveBeenCalledWith('team', 'repo', undefined, { maxAttempts: 1 })
  expect(db.prepare('SELECT plugins_count FROM repositories WHERE id = ?').get(id)).toEqual({ plugins_count: 2 })
  expect(listRunErrors(db, 'crawl-1')).toEqual([])
})

it.each(['repository', 'marketplace'] as const)('deletes a formerly publishable row on a confirmed %s 404', async (endpoint) => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old')
  ready(db, id)
  const getMarketplace = vi.fn(async () => ({ kind: 'not-found' as const }))
  const client = reader(
    async () => (endpoint === 'repository' ? { kind: 'not-found' } : { kind: 'found', data: githubRepo('team', 'repo') }),
    getMarketplace,
  )

  const counts = await enrichRepositories(db, client, 'crawl-1')

  expect(counts.deleted404).toBe(1)
  expect(counts.conclusive).toBe(1)
  expect(db.prepare('SELECT id FROM repositories WHERE id = ?').get(id)).toBeUndefined()
  expect(getMarketplace).toHaveBeenCalledTimes(endpoint === 'repository' ? 0 : 1)
})

it.each(['-legacy', 'legacy-'])('sends legacy owner %s to GitHub and deletes its id on confirmed 404', async (owner) => {
  const db = database()
  const id = upsertDiscovery(db, `https://github.com/${owner}/repo`, 'previously published')
  updateEnriched(db, id, {
    stargazers_count: 1,
    forks_count: 1,
    subscribers_count: 1,
    description: 'previously published',
    owner,
    owner_url: `https://github.com/${owner}`,
    repo_name: 'repo',
    repo_updated: '2024-01-01T00:00:00Z',
    plugins_count: 1,
  })
  expect(listPublishable(db).map((row) => row.id)).toEqual([id])
  const requests: Array<[string, string]> = []
  const client = reader(async (requestedOwner, requestedRepo) => {
    requests.push([requestedOwner, requestedRepo])
    return { kind: 'not-found' }
  })

  const counts = await enrichRepositories(db, client, 'crawl-1')

  expect(requests).toEqual([[owner, 'repo']])
  expect(counts).toMatchObject({ deleted404: 1, conclusive: 1, warnings: 0 })
  expect(db.prepare('SELECT id FROM repositories WHERE id = ?').get(id)).toBeUndefined()
  expect(listRunErrors(db, 'crawl-1')).toEqual([])
})

it('refreshes a complete row using the same owner and repo for both calls without changing its identity', async () => {
  const db = database()
  db.prepare(`
    INSERT INTO repositories (id, html_url, createdAt, updatedAt)
    VALUES (75, 'https://github.com/team/repo', 'original-created', 'original-updated')
  `).run()
  ready(db, 75)
  const requests: string[] = []
  const client = reader(
    async (owner, name) => {
      requests.push(`repo:${owner}/${name}`)
      return { kind: 'found', data: githubRepo(owner, name) }
    },
    async (owner, name) => {
      requests.push(`marketplace:${owner}/${name}`)
      return { kind: 'found', data: { plugins: [] } }
    },
  )

  expect(await enrichRepositories(db, client, 'crawl-1')).toMatchObject({ updated: 1, newReady: 0, conclusive: 1 })
  expect(requests).toEqual(['repo:team/repo', 'marketplace:team/repo'])
  expect(db.prepare('SELECT * FROM repositories WHERE id = 75').get()).toMatchObject({
    id: 75,
    html_url: 'https://github.com/team/repo',
    createdAt: 'original-created',
    updatedAt: expect.not.stringMatching('original-updated'),
    stargazers_count: 10,
    forks_count: 2,
    subscribers_count: 0,
    description: 'fresh',
    repo_updated: '2026-09-22T12:00:00Z',
    plugins_count: 0,
  })
  expect(db.prepare('SELECT COUNT(*) AS count FROM repositories').get()).toEqual({ count: 1 })
})

it('canonicalizes a case-variant URL while preserving the repository id', async () => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/Team/Repo', null)
  updateEnriched(db, id, {
    stargazers_count: 1,
    forks_count: 1,
    subscribers_count: 1,
    description: 'old',
    owner: 'Team',
    owner_url: 'https://github.com/Team',
    repo_name: 'Repo',
    repo_updated: 'old',
    plugins_count: 1,
  })
  const canonical = githubRepo('team', 'repo')
  const getMarketplace = vi.fn(async () => ({ kind: 'found' as const, data: { plugins: [1, 2] } }))

  expect(
    await enrichRepositories(
      db,
      reader(async () => ({ kind: 'found', data: canonical }), getMarketplace),
      'crawl-1',
    ),
  ).toMatchObject({ updated: 1, conclusive: 1, warnings: 0 })
  expect(getMarketplace).toHaveBeenCalledOnce()
  expect(getMarketplace).toHaveBeenCalledWith('team', 'repo', undefined, { maxAttempts: 1 })
  expect(db.prepare('SELECT id, html_url, owner, owner_url, repo_name, plugins_count FROM repositories').all()).toEqual([
    {
      id,
      html_url: 'https://github.com/team/repo',
      owner: 'team',
      owner_url: 'https://github.com/team',
      repo_name: 'repo',
      plugins_count: 2,
    },
  ])
  expect(listPublishable(db).map((row) => row.id)).toEqual([id])
})
it('counts a canonical merge as updated when the removed duplicate was already ready', async () => {
  const db = database()
  const originalId = upsertDiscovery(db, 'https://github.com/old-team/repo', null)
  db.prepare(`
    INSERT INTO repositories (id, html_url, createdAt, updatedAt)
    VALUES (500, 'https://github.com/new-team/repo', 'legacy-created', 'legacy-updated')
  `).run()
  ready(db, 500, 'new-team', 'repo')

  const counts = await enrichRepositories(
    db,
    reader(async () => ({ kind: 'found', data: githubRepo('new-team', 'repo') })),
    'crawl-1',
  )

  expect(counts).toMatchObject({ updated: 1, newReady: 0, conclusive: 1 })
  expect(db.prepare('SELECT id, html_url FROM repositories ORDER BY id').all()).toEqual([
    { id: originalId, html_url: 'https://github.com/new-team/repo' },
  ])
})

it('counts a canonical duplicate removed from a future page as processed', async () => {
  const db = database()
  const originalId = upsertDiscovery(db, 'https://github.com/old-team/repo', null)
  ready(db, originalId, 'old-team', 'repo')
  for (let id = 2; id <= 50; id++) {
    db.prepare('INSERT INTO repositories (id, html_url, createdAt, updatedAt) VALUES (?, NULL, ?, ?)').run(
      id,
      'legacy-created',
      'legacy-updated',
    )
  }
  db.prepare(`
    INSERT INTO repositories (id, html_url, createdAt, updatedAt)
    VALUES (500, 'https://github.com/new-team/repo', 'legacy-created', 'legacy-updated')
  `).run()
  ready(db, 500, 'new-team', 'repo')

  await enrichRepositories(
    db,
    reader(async (owner, name) => ({
      kind: 'found',
      data: owner === 'old-team' && name === 'repo' ? githubRepo('new-team', 'repo') : githubRepo(owner, name),
    })),
    'crawl-1',
  )

  expect(getRun(db, 'crawl-1')).toMatchObject({ phase: 'enrichment', phase_total: 51, phase_processed: 51 })
  expect(db.prepare('SELECT COUNT(*) AS count FROM repositories').get()).toEqual({ count: 1 })
})

it.each(['repository', 'marketplace'] as const)('deletes a case-variant URL on confirmed %s 404', async (endpoint) => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/Team/Repo', null)
  const getMarketplace = vi.fn(async () => ({ kind: 'not-found' as const }))
  const getRepository = async () =>
    endpoint === 'repository' ? ({ kind: 'not-found' } as const) : ({ kind: 'found', data: githubRepo('team', 'repo') } as const)

  expect(await enrichRepositories(db, reader(getRepository, getMarketplace), 'crawl-1')).toMatchObject({ deleted404: 1, conclusive: 1 })
  expect(getMarketplace).toHaveBeenCalledTimes(endpoint === 'repository' ? 0 : 1)
  expect(db.prepare('SELECT id FROM repositories WHERE id = ?').get(id)).toBeUndefined()
})

it('preserves complete rows on 429 and invalid marketplace content, records errors, and continues', async () => {
  const db = database()
  const ids = ['repo', 'other', 'third'].map((name) => upsertDiscovery(db, `https://github.com/team/${name}`, null))
  const [first, second, third] = ids
  if (first === undefined || second === undefined || third === undefined) throw new Error('Expected three fixtures')
  ready(db, first)
  updateEnriched(db, second, {
    stargazers_count: 4,
    forks_count: 2,
    subscribers_count: 0,
    description: 'old marketplace',
    owner: 'team',
    owner_url: 'https://github.com/team',
    repo_name: 'other',
    repo_updated: 'old',
    plugins_count: 1,
  })
  const before = ids.slice(0, 2).map((id) => db.prepare('SELECT * FROM repositories WHERE id = ?').get(id))
  const client = reader(undefined, async (_owner, name) => {
    if (name === 'repo') return { kind: 'temporary-error', status: 429, reason: 'GitHub rate limited', retryCount: 3 }
    if (name === 'other') return { kind: 'temporary-error', status: 200, reason: 'Invalid GitHub response', retryCount: 0 }
    return { kind: 'found', data: { plugins: [1, 2] } }
  })

  const counts = await enrichRepositories(db, client, 'crawl-1')

  expect(counts).toMatchObject({ unchangedOnError: 2, newReady: 1, conclusive: 1 })
  expect(ids.slice(0, 2).map((id) => db.prepare('SELECT * FROM repositories WHERE id = ?').get(id))).toEqual(before)
  expect(
    listRunErrors(db, 'crawl-1').map(({ repository_id, error_type, retry_count }) => ({ repository_id, error_type, retry_count })),
  ).toEqual([
    { repository_id: ids[0], error_type: 'marketplace_rate_limited', retry_count: 3 },
    { repository_id: ids[1], error_type: 'marketplace_invalid_response', retry_count: 0 },
  ])
  expect(db.prepare('SELECT plugins_count FROM repositories WHERE id = ?').get(third)).toEqual({ plugins_count: 2 })
})

it('reports zero conclusive enrichment when all repository requests succeed but marketplaces fail', async () => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', null)
  ready(db, id)
  const before = db.prepare('SELECT * FROM repositories WHERE id = ?').get(id)

  const counts = await enrichRepositories(
    db,
    reader(undefined, async () => ({ kind: 'temporary-error', status: 429, reason: 'GitHub rate limited', retryCount: 0 })),
    'crawl-1',
  )

  expect(counts).toMatchObject({ conclusive: 0, unchangedOnError: 1, updated: 0, deleted404: 0 })
  expect(db.prepare('SELECT * FROM repositories WHERE id = ?').get(id)).toEqual(before)
  expect(listRunErrors(db, 'crawl-1').map(({ error_type }) => error_type)).toEqual(['marketplace_rate_limited'])
})

it('keeps an incomplete row unpublishable until both endpoints succeed', async () => {
  const db = database()
  db.prepare(`
    INSERT INTO repositories (id, html_url, description, createdAt, updatedAt)
    VALUES (211, 'https://github.com/team/repo', 'legacy', '2020-01-01', '2020-01-02')
  `).run()
  const failed = await enrichRepositories(
    db,
    reader(async () => ({ kind: 'temporary-error', status: null, reason: 'GitHub network error', retryCount: 0 })),
    'crawl-1',
  )
  expect(failed).toMatchObject({ newIncomplete: 1, conclusive: 0 })
  expect(listPublishable(db)).toEqual([])

  const successful = await enrichRepositories(db, reader(), 'crawl-1')
  expect(successful).toMatchObject({ newReady: 1, conclusive: 1 })
  expect(db.prepare('SELECT * FROM repositories WHERE id = 211').get()).toMatchObject({
    id: 211,
    html_url: 'https://github.com/team/repo',
    createdAt: '2020-01-01',
    description: 'fresh',
    stargazers_count: 10,
    forks_count: 2,
    subscribers_count: 0,
    owner: 'team',
    owner_url: 'https://github.com/team',
    repo_name: 'repo',
    repo_updated: '2026-09-22T12:00:00Z',
    plugins_count: 0,
    updatedAt: expect.not.stringMatching('2020-01-02'),
  })
  expect(listPublishable(db)).toHaveLength(1)
  expect(upsertDiscovery(db, 'https://github.com/team/repo', 'rediscovered')).toBe(211)
  expect(db.prepare('SELECT COUNT(*) AS count FROM repositories').get()).toEqual({ count: 1 })
})

it('follows a confirmed GitHub rename or transfer and keeps the original repository id', async () => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', null)
  ready(db, id)
  const requests: string[] = []
  const moved = githubRepo('new-team', 'new-repo')

  const counts = await enrichRepositories(
    db,
    reader(
      async (owner, name) => {
        requests.push(`repo:${owner}/${name}`)
        return { kind: 'found', data: moved }
      },
      async (owner, name) => {
        requests.push(`marketplace:${owner}/${name}`)
        return { kind: 'found', data: { plugins: [1, 2] } }
      },
    ),
    'crawl-1',
  )

  expect(counts).toMatchObject({ updated: 1, conclusive: 1, warnings: 0 })
  expect(requests).toEqual(['repo:team/repo', 'marketplace:new-team/new-repo'])
  expect(db.prepare('SELECT id, html_url, owner, owner_url, repo_name, plugins_count FROM repositories').all()).toEqual([
    {
      id,
      html_url: 'https://github.com/new-team/new-repo',
      owner: 'new-team',
      owner_url: 'https://github.com/new-team',
      repo_name: 'new-repo',
      plugins_count: 2,
    },
  ])
  expect(listRunErrors(db, 'crawl-1')).toEqual([])
})

it('keeps both rows unchanged when a renamed repository marketplace lookup fails', async () => {
  const db = database()
  const originalId = upsertDiscovery(db, 'https://github.com/team/repo', null)
  ready(db, originalId)
  const duplicateId = upsertDiscovery(db, 'https://github.com/new-team/new-repo', null)
  ready(db, duplicateId, 'new-team', 'new-repo')
  const before = [originalId, duplicateId].map((id) => db.prepare('SELECT * FROM repositories WHERE id = ?').get(id))

  const counts = await enrichRepositories(
    db,
    reader(
      async (owner, name) => ({
        kind: 'found' as const,
        data: owner === 'team' && name === 'repo' ? githubRepo('new-team', 'new-repo') : githubRepo(owner, name),
      }),
      async () => ({ kind: 'temporary-error' as const, status: 429, reason: 'GitHub rate limited', retryCount: 0 }),
    ),
    'crawl-1',
  )

  expect(counts).toMatchObject({ unchangedOnError: 2, deleted404: 0, conclusive: 0 })
  expect([originalId, duplicateId].map((id) => db.prepare('SELECT * FROM repositories WHERE id = ?').get(id))).toEqual(before)
  expect(listPublishable(db).map(({ id }) => id)).toEqual([originalId, duplicateId])
})

it('merges a discovered canonical duplicate during rename and does not enrich the deleted duplicate twice', async () => {
  const db = database()
  const originalId = upsertDiscovery(db, 'https://github.com/team/repo', null)
  ready(db, originalId)
  const duplicateId = upsertDiscovery(db, 'https://github.com/new-team/new-repo', 'discovered after rename')
  const getRepository = vi.fn(async (owner: string, name: string) => ({
    kind: 'found' as const,
    data: owner === 'team' && name === 'repo' ? githubRepo('new-team', 'new-repo') : githubRepo(owner, name),
  }))
  const getMarketplace = vi.fn(async () => ({ kind: 'found' as const, data: { plugins: [] } }))

  const counts = await enrichRepositories(db, reader(getRepository, getMarketplace), 'crawl-1')

  expect(counts).toMatchObject({ updated: 1, newReady: 0, conclusive: 1, warnings: 0 })
  expect(getRepository).toHaveBeenCalledTimes(1)
  expect(getRepository).toHaveBeenCalledWith('team', 'repo', undefined, { maxAttempts: 1 })
  expect(getMarketplace).toHaveBeenCalledTimes(1)
  expect(getMarketplace).toHaveBeenCalledWith('new-team', 'new-repo', undefined, { maxAttempts: 1 })
  expect(db.prepare('SELECT id, html_url, owner, repo_name FROM repositories').all()).toEqual([
    { id: originalId, html_url: 'https://github.com/new-team/new-repo', owner: 'new-team', repo_name: 'new-repo' },
  ])
  expect(db.prepare('SELECT id FROM repositories WHERE id = ?').get(duplicateId)).toBeUndefined()
})

it('skips a canonical duplicate deleted after a renamed repository marketplace 404', async () => {
  const db = database()
  const originalId = upsertDiscovery(db, 'https://github.com/team/repo', null)
  ready(db, originalId)
  const duplicateId = upsertDiscovery(db, 'https://github.com/new-team/new-repo', null)
  ready(db, duplicateId, 'new-team', 'new-repo')
  const getRepository = vi.fn(async (owner: string, name: string) => ({
    kind: 'found' as const,
    data: owner === 'team' && name === 'repo' ? githubRepo('new-team', 'new-repo') : githubRepo(owner, name),
  }))
  const getMarketplace = vi.fn(async () => ({ kind: 'not-found' as const }))

  const counts = await enrichRepositories(db, reader(getRepository, getMarketplace), 'crawl-1')

  expect(counts).toMatchObject({ deleted404: 1, conclusive: 1, updated: 0, newReady: 0 })
  expect(getRepository).toHaveBeenCalledTimes(1)
  expect(getRepository).toHaveBeenCalledWith('team', 'repo', undefined, { maxAttempts: 1 })
  expect(getMarketplace).toHaveBeenCalledTimes(1)
  expect(getMarketplace).toHaveBeenCalledWith('new-team', 'new-repo', undefined, { maxAttempts: 1 })
  expect(db.prepare('SELECT id FROM repositories WHERE id IN (?, ?)').all(originalId, duplicateId)).toEqual([])
  expect(db.prepare('SELECT html_url FROM rejected_repository_candidates').all()).toEqual([
    { html_url: 'https://github.com/new-team/new-repo' },
  ])
})

it.each(['name', 'owner', 'html_url', 'owner_url'] as const)(
  'does not rebind the original id when GitHub changes the %s',
  async (field) => {
    const db = database()
    const id = upsertDiscovery(db, 'https://github.com/team/repo', null)
    ready(db, id)
    const before = db.prepare('SELECT * FROM repositories WHERE id = ?').get(id)
    const moved = githubRepo('team', 'repo')
    const data: GitHubRepo =
      field === 'owner_url'
        ? { ...moved, owner: { ...moved.owner, html_url: 'https://github.com/other' } }
        : field === 'owner'
          ? { ...moved, owner: { ...moved.owner, login: 'other' } }
          : { ...moved, [field]: field === 'html_url' ? 'https://github.com/team/other' : 'other' }
    const getMarketplace = vi.fn(async () => ({ kind: 'found' as const, data: { plugins: [] } }))

    const counts = await enrichRepositories(
      db,
      reader(async () => ({ kind: 'found', data }), getMarketplace),
      'crawl-1',
    )

    expect(counts).toMatchObject({ unchangedOnError: 1, warnings: 1, conclusive: 0 })
    expect(db.prepare('SELECT * FROM repositories WHERE id = ?').get(id)).toEqual(before)
    expect(listRunErrors(db, 'crawl-1').map(({ error_type }) => error_type)).toEqual(['repository_identity_mismatch'])
    expect(getMarketplace).not.toHaveBeenCalled()
  },
)

it.each([
  'https://github.com/team/repo?token=bad',
  'https://github.com/team/repo#section',
  'https://github.com/team/repo/extra',
  'https://github.com/team/repo/',
  'https://github.com/team/..',
  'https://github.com/./repo',
  'https://github.com/team/%72epo',
  'https://github.com:443/team/repo',
  'https://evil.example/team/repo',
  'https://user@github.com/team/repo',
  'http://github.com/team/repo',
])('retains malformed URL %s without sending it to the reader', async (url) => {
  const db = database()
  const id = upsertDiscovery(db, url, null)
  const getRepository = vi.fn()
  const counts = await enrichRepositories(db, reader(getRepository), 'crawl-1')

  expect(counts).toMatchObject({ newIncomplete: 1, conclusive: 0, warnings: 1 })
  expect(db.prepare('SELECT id, html_url FROM repositories WHERE id = ?').get(id)).toEqual({ id, html_url: url })
  expect(listRunErrors(db, 'crawl-1').map(({ error_type }) => error_type)).toEqual(['invalid_repository_url'])
  expect(getRepository).not.toHaveBeenCalled()
})

it('reports zero conclusive responses when every API result is transient', async () => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', null)
  const counts = await enrichRepositories(
    db,
    reader(async () => ({ kind: 'temporary-error', status: 503, reason: 'GitHub server error', retryCount: 0 })),
    'crawl-1',
  )

  expect(counts).toMatchObject({ conclusive: 0, newIncomplete: 1, deleted404: 0 })
  expect(db.prepare('SELECT id FROM repositories WHERE id = ?').get(id)).toEqual({ id })
  expect(listRunErrors(db, 'crawl-1').map(({ phase, error_type }) => ({ phase, error_type }))).toEqual([
    { phase: 'enrich', error_type: 'repository_temporary_error' },
  ])
})

it('aborts on fatal reader errors while retaining earlier per-row updates', async () => {
  const db = database()
  const first = upsertDiscovery(db, 'https://github.com/team/first', null)
  const second = upsertDiscovery(db, 'https://github.com/team/second', null)
  const client = reader(async (owner, name) => {
    if (name === 'second') throw new GitHubFatalError('bad credentials', 401)
    return { kind: 'found', data: githubRepo(owner, name) }
  })

  await expect(enrichRepositories(db, client, 'crawl-1')).rejects.toBeInstanceOf(GitHubFatalError)
  expect(db.prepare('SELECT owner FROM repositories WHERE id = ?').get(first)).toEqual({ owner: 'team' })
  expect(db.prepare('SELECT owner FROM repositories WHERE id = ?').get(second)).toEqual({ owner: null })
  expect(getRun(db, 'crawl-1')).toMatchObject({ phase: 'enrichment', phase_total: 2, phase_processed: 1 })
})

it('bypasses a cached ETag when stale failed content falls back from missing GraphQL metadata to legacy REST', async () => {
  const db = database()
  const nodeId = 'node-stale-negative-cache-legacy'
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old', new Date().toISOString(), nodeId)
  ready(db, id)
  const oid = '1'.repeat(40)
  db.prepare(
    'UPDATE repositories SET marketplace_oid = ?, marketplace_etag = ?, marketplace_failed_oid = ?, marketplace_failed_parser_version = 1 WHERE id = ?',
  ).run(oid, '"old"', oid, id)

  const getRepository = vi.fn(async () => ({ kind: 'found' as const, data: githubRepo('team', 'repo') }))
  const getMarketplace = vi.fn(async () => ({
    kind: 'found' as const,
    data: { plugins: [1, 2] },
    etag: '"new"',
  }))
  const client = {
    ...reader(getRepository, getMarketplace),
    getRepositoriesByNodeId: async () => ({
      kind: 'found' as const,
      data: [null],
      rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
    }),
  }

  await enrichRepositories(db, client, 'crawl-1')

  expect(getRepository).toHaveBeenCalledWith('team', 'repo', undefined, { maxAttempts: 1 })
  expect(getMarketplace).toHaveBeenCalledWith('team', 'repo', undefined, { maxAttempts: 1 })
  expect(
    db
      .prepare(
        'SELECT plugins_count, marketplace_etag, marketplace_failed_oid, marketplace_failed_parser_version FROM repositories WHERE id = ?',
      )
      .get(id),
  ).toEqual({
    plugins_count: 2,
    marketplace_etag: '"new"',
    marketplace_failed_oid: null,
    marketplace_failed_parser_version: null,
  })
})

it('bypasses a cached ETag when stale failed marketplace content falls back to REST', async () => {
  const db = database()
  const nodeId = 'node-stale-negative-cache-rest'
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old', new Date().toISOString(), nodeId)
  ready(db, id)
  const oid = 'f'.repeat(40)
  db.prepare(
    'UPDATE repositories SET marketplace_oid = ?, marketplace_etag = ?, marketplace_failed_oid = ?, marketplace_failed_parser_version = 1 WHERE id = ?',
  ).run(oid, '"old"', oid, id)

  const getMarketplace = vi.fn(async () => ({
    kind: 'found' as const,
    data: { plugins: [1, 2] },
    etag: '"new"',
  }))
  const getMarketplaceBlobsByNodeId = vi.fn(async () => {
    throw new Error('indeterminate encodings should bypass GraphQL text batching')
  })
  const client = {
    ...reader(undefined, getMarketplace),
    getRepositoriesByNodeId: async () => ({
      kind: 'found' as const,
      data: [
        {
          ...githubRepo('team', 'repo'),
          node_id: nodeId,
          marketplace_oid: oid,
          marketplace_byte_size: 100,
          marketplace_is_binary: null,
        },
      ],
      rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
    }),
    getMarketplaceBlobsByNodeId,
  }

  await enrichRepositories(db, client, 'crawl-1')

  expect(getMarketplaceBlobsByNodeId).not.toHaveBeenCalled()
  expect(getMarketplace).toHaveBeenCalledWith('team', 'repo', undefined, { maxAttempts: 1 })
  expect(
    db
      .prepare(
        'SELECT plugins_count, marketplace_etag, marketplace_failed_oid, marketplace_failed_parser_version FROM repositories WHERE id = ?',
      )
      .get(id),
  ).toEqual({
    plugins_count: 2,
    marketplace_etag: '"new"',
    marketplace_failed_oid: null,
    marketplace_failed_parser_version: null,
  })
})

it('bypasses a cached ETag when a stale parser version falls back from GraphQL to REST', async () => {
  const db = database()
  const nodeId = 'node-stale-parser-version-rest'
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old', new Date().toISOString(), nodeId)
  ready(db, id)
  const oid = 'a'.repeat(40)
  db.prepare('UPDATE repositories SET marketplace_oid = ?, marketplace_etag = ?, marketplace_parser_version = 1 WHERE id = ?').run(
    oid,
    '"old"',
    id,
  )

  const getMarketplace = vi.fn(async () => ({
    kind: 'found' as const,
    data: { plugins: [1, 2] },
    etag: '"new"',
  }))
  const getMarketplaceBlobsByNodeId = vi.fn(async () => {
    throw new Error('indeterminate encodings should bypass GraphQL text batching')
  })
  const client = {
    ...reader(undefined, getMarketplace),
    getRepositoriesByNodeId: async () => ({
      kind: 'found' as const,
      data: [
        {
          ...githubRepo('team', 'repo'),
          node_id: nodeId,
          marketplace_oid: oid,
          marketplace_byte_size: 100,
          marketplace_is_binary: null,
        },
      ],
      rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
    }),
    getMarketplaceBlobsByNodeId,
  }

  await enrichRepositories(db, client, 'crawl-1')

  expect(getMarketplaceBlobsByNodeId).not.toHaveBeenCalled()
  expect(getMarketplace).toHaveBeenCalledWith('team', 'repo', undefined, { maxAttempts: 1 })
  expect(
    db
      .prepare('SELECT plugins_count, marketplace_etag, marketplace_oid, marketplace_parser_version FROM repositories WHERE id = ?')
      .get(id),
  ).toEqual({
    plugins_count: 2,
    marketplace_etag: '"new"',
    marketplace_oid: oid,
    marketplace_parser_version: MARKETPLACE_PARSER_VERSION,
  })
})

it('does not accept an unexpected REST 304 when the cached marketplace parser version is stale', async () => {
  const db = database()
  const nodeId = 'node-stale-parser-version-unexpected-304'
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old', new Date().toISOString(), nodeId)
  ready(db, id)
  const oid = 'b'.repeat(40)
  db.prepare('UPDATE repositories SET marketplace_oid = ?, marketplace_etag = ?, marketplace_parser_version = 1 WHERE id = ?').run(
    oid,
    '"old"',
    id,
  )

  const getMarketplace = vi.fn(async () => ({ kind: 'not-modified' as const, etag: '"old"' }))
  const client = {
    ...reader(undefined, getMarketplace),
    getRepositoriesByNodeId: async () => ({
      kind: 'found' as const,
      data: [
        {
          ...githubRepo('team', 'repo'),
          node_id: nodeId,
          marketplace_oid: oid,
          marketplace_byte_size: 100,
          marketplace_is_binary: null,
        },
      ],
      rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
    }),
  }

  await enrichRepositories(db, client, 'crawl-1')

  expect(getMarketplace).toHaveBeenCalledWith('team', 'repo', undefined, { maxAttempts: 1 })
  expect(db.prepare('SELECT plugins_count, marketplace_parser_version FROM repositories WHERE id = ?').get(id)).toEqual({
    plugins_count: 3,
    marketplace_parser_version: 1,
  })
  expect(listRunErrors(db, 'crawl-1').map(({ error_type }) => error_type)).toContain('marketplace_not_modified_with_stale_parser')
})

it('reprocesses a matching failed marketplace OID from an older content-cache version', async () => {
  const db = database()
  const nodeId = 'node-stale-negative-cache'
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old', new Date().toISOString(), nodeId)
  ready(db, id)
  const oid = 'e'.repeat(40)
  db.prepare(
    'UPDATE repositories SET marketplace_oid = ?, marketplace_failed_oid = ?, marketplace_failed_parser_version = 1 WHERE id = ?',
  ).run(oid, oid, id)

  const getMarketplace = vi.fn(async () => ({ kind: 'temporary-error' as const, status: 500, reason: 'REST must not run', retryCount: 0 }))
  const getMarketplaceBlobsByNodeId = vi.fn(async () => ({
    kind: 'found' as const,
    data: [graphQLMarketplaceBlob(nodeId, oid)],
    rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
  }))
  const client = {
    ...reader(undefined, getMarketplace),
    getRepositoriesByNodeId: async () => ({
      kind: 'found' as const,
      data: [
        {
          ...githubRepo('team', 'repo'),
          node_id: nodeId,
          marketplace_oid: oid,
          marketplace_byte_size: 100,
          marketplace_is_binary: false,
        },
      ],
      rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
    }),
    getMarketplaceBlobsByNodeId,
  }

  await enrichRepositories(db, client, 'crawl-1')

  expect(getMarketplaceBlobsByNodeId).toHaveBeenCalledWith([nodeId])
  expect(getMarketplace).not.toHaveBeenCalled()
  expect(
    db
      .prepare(
        'SELECT plugins_count, marketplace_oid, marketplace_failed_oid, marketplace_failed_parser_version FROM repositories WHERE id = ?',
      )
      .get(id),
  ).toEqual({
    plugins_count: validMarketplaceFixture.pluginsCount,
    marketplace_oid: oid,
    marketplace_failed_oid: null,
    marketplace_failed_parser_version: null,
  })
})

it('rolls back successful GraphQL enrichment writes when a later row in the response batch fails', async () => {
  const db = database()
  const nodeIds = ['node-one', 'node-two']
  const ids = nodeIds.map((nodeId, index) =>
    upsertDiscovery(db, `https://github.com/team/repo${index + 1}`, 'old', new Date().toISOString(), nodeId),
  )
  db.exec(`
    CREATE TRIGGER reject_second_graphql_enrichment BEFORE UPDATE OF stargazers_count ON repositories
    WHEN OLD.id = ${ids[1]}
    BEGIN SELECT RAISE(ABORT, 'blocked GraphQL row'); END;
  `)
  const client: GitHubReader = {
    ...reader(),
    getRepositoriesByNodeId: async () => ({
      kind: 'found',
      data: nodeIds.map((_, index) => ({
        ...githubRepo('team', `repo${index + 1}`),
        node_id: nodeIds[index] ?? '',
        marketplace_oid: null,
      })),
      rateLimit: { cost: 2, remaining: 4_998, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 2 },
    }),
  }

  await expect(enrichRepositories(db, client, 'crawl-1')).rejects.toThrow('blocked GraphQL row')
  expect(db.prepare('SELECT id, stargazers_count FROM repositories ORDER BY id').all()).toEqual([
    { id: ids[0], stargazers_count: null },
    { id: ids[1], stargazers_count: null },
  ])
})

it('stores invalid marketplace state on the actual ID after earlier batched canonical rebinds', async () => {
  const db = database()
  const firstId = upsertDiscovery(db, 'https://github.com/team/old', null, new Date().toISOString(), 'node-first')
  const secondId = upsertDiscovery(db, 'https://github.com/team/other', null, new Date().toISOString(), 'node-second')
  ready(db, firstId, 'team', 'old')
  ready(db, secondId, 'team', 'other')
  const invalidOid = 'f'.repeat(40)
  const client: GitHubReader = {
    ...reader(),
    getRepositoriesByNodeId: async () => ({
      kind: 'found',
      data: [
        { ...githubRepo('team', 'renamed'), node_id: 'node-first', marketplace_oid: null },
        {
          ...githubRepo('team', 'old'),
          node_id: 'node-second',
          marketplace_oid: invalidOid,
          marketplace_byte_size: 20,
          marketplace_is_binary: false,
        },
      ],
      rateLimit: { cost: 2, remaining: 4_998, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 2 },
    }),
    getMarketplaceBlobsByNodeId: async () => ({
      kind: 'found',
      data: [graphQLMarketplaceBlob('node-second', invalidOid, { text: '{invalid json' })],
      rateLimit: { cost: 1, remaining: 4_997, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 3 },
    }),
  }

  await enrichRepositories(db, client, 'crawl-1')

  expect(db.prepare('SELECT id, html_url, marketplace_failed_oid FROM repositories ORDER BY id').all()).toEqual([
    { id: firstId, html_url: 'https://github.com/team/renamed', marketplace_failed_oid: null },
    { id: secondId, html_url: 'https://github.com/team/old', marketplace_failed_oid: invalidOid },
  ])
})

it('enriches persisted license and archive data and uses immutable discovery timestamp', async () => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', null, '2025-01-02T03:04:05.000Z')
  const client = reader(async (owner, name) => ({
    kind: 'found',
    data: { ...githubRepo(owner, name), archived: true, license: { spdx_id: 'MIT' } },
  }))
  await enrichRepositories(db, client, 'crawl-1')
  const row = db.prepare('SELECT license, archived, createdAt FROM repositories WHERE id = ?').get(id)
  expect(row).toEqual({ license: 'MIT', archived: 1, createdAt: '2025-01-02T03:04:05.000Z' })
  expect(JSON.parse(renderRepos(listPublishable(db)))[0]).toMatchObject({
    pushed_at: '2026-09-22T12:00:00.000Z',
    catalog_added_at: '2025-01-02T03:04:05.000Z',
    license: 'MIT',
    archived: true,
  })
})

it('backfills archived metadata without reusing a legacy REST ETag', async () => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', null)
  ready(db, id)
  db.prepare('UPDATE repositories SET repository_etag = ? WHERE id = ?').run('"old-etag"', id)
  const getRepository = vi.fn(async (owner: string, name: string) => ({
    kind: 'found' as const,
    data: { ...githubRepo(owner, name), archived: false, license: null },
  }))
  await enrichRepositories(db, reader(getRepository), 'crawl-1')
  expect(getRepository).toHaveBeenCalledWith('team', 'repo', undefined, { maxAttempts: 1 })
  expect(db.prepare('SELECT archived, license FROM repositories WHERE id = ?').get(id)).toEqual({
    archived: 0,
    license: null,
  })
})

it('isolates an administratively blocked repository during enrichment, records warning, and excludes it from catalog', async () => {
  const db = database()
  const blockedId = upsertDiscovery(db, 'https://github.com/Prekzursil/agent-skills-toolchain', null)
  const healthyId = upsertDiscovery(db, 'https://github.com/team/healthy', null)
  ready(db, healthyId, 'team', 'healthy')

  const getRepository = vi.fn(async (owner: string, repoName: string) => {
    if (owner === 'Prekzursil') {
      return {
        kind: 'repository-blocked' as const,
        status: 403,
        reason: 'Repository access blocked',
        blockReason: 'private_information',
        blockedAt: '2026-11-03T19:00:04Z',
        retryCount: 0,
      }
    }
    return { kind: 'found' as const, data: githubRepo(owner, repoName) }
  })
  const getMarketplace = vi.fn(async () => ({ kind: 'found' as const, data: { plugins: [{ name: 'healthy' }] } }))
  const log = vi.fn()

  const now = () => '2026-11-05T08:00:00.000Z'
  const counts = await enrichRepositories(db, reader(getRepository, getMarketplace), 'crawl-1', undefined, now, log)

  expect(counts).toMatchObject({ updated: 1, warnings: 1, conclusive: 2 })
  expect(log).toHaveBeenCalledWith(
    expect.objectContaining({
      event: 'crawl.repository_blocked',
      category: 'repository_blocked',
      repository: 'Prekzursil/agent-skills-toolchain',
      status: 403,
      reason: 'private_information',
    }),
  )

  const blockedRow = db.prepare('SELECT blocked_at, blocked_reason, plugins_count FROM repositories WHERE id = ?').get(blockedId) as {
    blocked_at: string | null
    blocked_reason: string | null
    plugins_count: number | null
  }
  expect(blockedRow.blocked_at).toBe('2026-11-05T08:00:00.000Z')
  expect(blockedRow.blocked_reason).toBe('private_information')

  expect(listCoreComplete(db).map((r) => r.id)).toEqual([healthyId])
  expect(listPublishable(db).map((r) => r.id)).toEqual([healthyId])
  expect(listRunErrors(db, 'crawl-1')).toEqual([
    expect.objectContaining({
      repository_id: blockedId,
      error_type: 'repository_blocked',
    }),
  ])
})

it('records discovery timestamp in blocked_at for older GitHub blocks so they are not re-crawled the next day', async () => {
  const db = database()
  const blockedId = upsertDiscovery(db, 'https://github.com/Prekzursil/agent-skills-toolchain', null)
  ready(db, blockedId, 'Prekzursil', 'agent-skills-toolchain')

  const discoveryTime = '2026-11-05T12:00:00.000Z'
  const nextDay = '2026-11-06T12:00:00.000Z'

  const getRepository = vi.fn(async () => ({
    kind: 'repository-blocked' as const,
    status: 403,
    reason: 'Repository access blocked',
    blockReason: 'private_information',
    blockedAt: '2020-01-01T00:00:00Z',
    retryCount: 0,
  }))
  const getMarketplace = vi.fn()

  await enrichRepositories(db, reader(getRepository, getMarketplace), 'crawl-1', undefined, () => discoveryTime)

  const blockedRow = db.prepare('SELECT blocked_at, blocked_reason FROM repositories WHERE id = ?').get(blockedId) as {
    blocked_at: string | null
    blocked_reason: string | null
  }
  expect(blockedRow.blocked_at).toBe(discoveryTime)
  expect(blockedRow.blocked_reason).toBe('private_information')

  completeRun(db, 'crawl-1', discoveryTime, 1)
  beginRun(db, 'crawl-2', nextDay)
  getRepository.mockClear()
  const secondRunCounts = await enrichRepositories(db, reader(getRepository, getMarketplace), 'crawl-2', undefined, () => nextDay)

  expect(getRepository).not.toHaveBeenCalled()
  expect(secondRunCounts).toMatchObject({ unchangedOnError: 1, updated: 0 })
})

it('skips enrichment of a blocked repository within the 7-day TTL without querying GitHub', async () => {
  const db = database()
  const blockedId = upsertDiscovery(db, 'https://github.com/Prekzursil/agent-skills-toolchain', null)
  markRepositoryBlocked(db, blockedId, 'private_information', new Date().toISOString())

  const getRepository = vi.fn()
  const getMarketplace = vi.fn()

  const counts = await enrichRepositories(db, reader(getRepository, getMarketplace), 'crawl-1')

  expect(getRepository).not.toHaveBeenCalled()
  expect(getMarketplace).not.toHaveBeenCalled()
  expect(counts).toMatchObject({ unchangedOnError: 1, updated: 0, warnings: 0 })
})

it('re-enriches a blocked repository after the 7-day TTL and clears blocked state on success', async () => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/recovered/repo', null)
  ready(db, id, 'recovered', 'repo')
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
  markRepositoryBlocked(db, id, 'private_information', eightDaysAgo)

  const getRepository = vi.fn(async (owner: string, name: string) => ({
    kind: 'found' as const,
    data: githubRepo(owner, name),
  }))
  const getMarketplace = vi.fn(async () => ({ kind: 'found' as const, data: { plugins: [{ name: 'recovered' }] } }))

  const counts = await enrichRepositories(db, reader(getRepository, getMarketplace), 'crawl-1')

  expect(getRepository).toHaveBeenCalledWith('recovered', 'repo', undefined, { maxAttempts: 1 })
  expect(counts).toMatchObject({ updated: 1, conclusive: 1, warnings: 0 })

  const row = db.prepare('SELECT blocked_at, blocked_reason FROM repositories WHERE id = ?').get(id) as {
    blocked_at: string | null
    blocked_reason: string | null
  }
  expect(row.blocked_at).toBeNull()
  expect(row.blocked_reason).toBeNull()
})

it('skips enrichment of an alias repository sharing a GitHub node ID with an actively blocked repository', async () => {
  const db = database()
  const nodeId = 'shared-node-id-enrich'
  const now = '2026-11-05T12:00:00.000Z'
  const oneDayAgo = '2026-11-04T12:00:00.000Z'

  const blockedId = upsertDiscovery(db, 'https://github.com/primary/repo', null)
  ready(db, blockedId, 'primary', 'repo')
  db.prepare('UPDATE repositories SET github_node_id = ?, blocked_at = ?, blocked_reason = ? WHERE id = ?').run(
    nodeId,
    oneDayAgo,
    'dmca',
    blockedId,
  )

  const aliasId = upsertDiscovery(db, 'https://github.com/alias/repo', null)
  ready(db, aliasId, 'alias', 'repo')
  db.prepare('UPDATE repositories SET github_node_id = ?, blocked_at = NULL WHERE id = ?').run(nodeId, aliasId)

  const getRepository = vi.fn()
  const getMarketplace = vi.fn()

  const counts = await enrichRepositories(db, reader(getRepository, getMarketplace), 'crawl-1', undefined, () => now)

  expect(getRepository).not.toHaveBeenCalled()
  expect(counts).toMatchObject({ unchangedOnError: 2, updated: 0 })
})
