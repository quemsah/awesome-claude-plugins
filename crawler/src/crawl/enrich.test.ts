import { marketplaceFixtures } from '@awesome-claude-plugins/marketplace-contract/fixtures'
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
import { listPublishable, updateEnriched, upsertDiscovery } from '../storage/repositories.js'
import { beginRun, getRun, listRunErrors } from '../storage/runs.js'
import { initializeSchema } from '../storage/schema.js'
import { enrichRepositories } from './enrich.js'

const databases: Database.Database[] = []

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
  })
}

const validMarketplaceFixture = (() => {
  const fixture = marketplaceFixtures.find((candidate) => candidate.valid)
  if (!fixture) throw new Error('Expected at least one valid marketplace fixture')
  return fixture
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

it('uses batched GraphQL metadata and skips marketplace REST when the stored OID is unchanged', async () => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old', new Date().toISOString(), 'MDEwOlJlcG9zaXRvcnkx')
  ready(db, id)
  const oid = 'a'.repeat(40)
  db.prepare('UPDATE repositories SET marketplace_oid = ?, marketplace_parser_version = 1 WHERE id = ?').run(oid, id)
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

it('reparses an unchanged marketplace OID when the cached parser version is missing', async () => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old', new Date().toISOString(), 'MDEwOlJlcG9zaXRvcnkx')
  ready(db, id)
  const oid = 'a'.repeat(40)
  db.prepare('UPDATE repositories SET marketplace_oid = ?, marketplace_etag = ? WHERE id = ?').run(oid, '"old"', id)
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
    marketplace_parser_version: 1,
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
    'UPDATE repositories SET plugins_count = NULL, marketplace_oid = ?, marketplace_etag = ?, marketplace_parser_version = 1 WHERE id = ?',
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
  db.prepare('UPDATE repositories SET marketplace_oid = ?, marketplace_parser_version = 1 WHERE id = ?').run('a'.repeat(40), id)
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
    marketplace_failed_parser_version: 1,
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
    marketplace_failed_parser_version: 1,
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
        }
      }
      return { kind: 'found', data: githubRepo(owner, name) }
    },
    getMarketplace: async (_owner, name, _etag, options) => {
      calls.push(`marketplace:${name}:max${options?.maxAttempts ?? 3}`)
      return { kind: 'found', data: { plugins: [] } }
    },
  }

  const counts = await enrichRepositories(db, client, 'crawl-1')

  expect(counts).toMatchObject({ newReady: 2, conclusive: 2, unchangedOnError: 0, newIncomplete: 0 })
  expect(calls).toEqual(['repo:first:max1', 'repo:second:max1', 'marketplace:second:max1', 'repo:first:max2', 'marketplace:first:max2'])
  expect(listRunErrors(db, 'crawl-1')).toEqual([])
  expect(getRun(db, 'crawl-1')).toMatchObject({ phase: 'enrichment', phase_total: 2, phase_processed: 2 })
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

it('reparses the same marketplace OID through GraphQL when the parser version is stale', async () => {
  const db = database()
  const nodeId = 'MDEwOlJlcG9zaXRvcnky'
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old', new Date().toISOString(), nodeId)
  ready(db, id)
  const oid = 'a'.repeat(40)
  db.prepare('UPDATE repositories SET marketplace_oid = ?, marketplace_parser_version = NULL WHERE id = ?').run(oid, id)
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
    marketplace_parser_version: 1,
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
  const client = {
    ...reader(undefined, getMarketplace),
    getRepositoriesByNodeId: async () => ({
      kind: 'found' as const,
      data: metadata,
      rateLimit: { cost: 1, remaining: 4_999, resetAt: '2026-09-23T23:00:00Z', limit: 5_000, used: 1 },
    }),
    getMarketplaceBlobsByNodeId,
  }

  const counts = await enrichRepositories(db, client, 'crawl-1')

  expect(counts).toMatchObject({ updated: 2, conclusive: 2, warnings: 0 })
  expect(getMarketplaceBlobsByNodeId.mock.calls.map(([nodeIds]) => nodeIds)).toEqual([['node-one', 'node-two'], ['node-one'], ['node-two']])
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
  const client = {
    ...reader(undefined, getMarketplace),
    getRepositoriesByNodeId,
    getMarketplaceBlobsByNodeId,
  }

  const counts = await enrichRepositories(db, client, 'crawl-1')

  expect(counts).toMatchObject({ updated: 11, conclusive: 11, warnings: 0 })
  expect(getRepositoriesByNodeId.mock.calls.map(([nodeIds]) => nodeIds.length)).toEqual([11, 10, 1])
  expect(getMarketplaceBlobsByNodeId.mock.calls.map(([nodeIds]) => nodeIds.length)).toEqual([10, 1])
  expect(getMarketplace).not.toHaveBeenCalled()
})

it('reuses cached repository metadata after a conditional REST 304', async () => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old')
  ready(db, id)
  db.prepare('UPDATE repositories SET repository_etag = ?, marketplace_etag = ?, marketplace_parser_version = 1 WHERE id = ?').run(
    '"repo"',
    '"manifest"',
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
