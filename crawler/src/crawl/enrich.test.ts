import Database from 'better-sqlite3'
import { afterEach, expect, it, vi } from 'vitest'
import { GitHubFatalError, type GitHubReader, type GitHubRepo, type Marketplace, type RepoResult } from '../github/client.js'
import { listPublishable, updateEnriched, upsertDiscovery } from '../storage/repositories.js'
import { beginRun, listRunErrors } from '../storage/runs.js'
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

it('reuses plugins_count when the repository push timestamp is unchanged', async () => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old')
  updateEnriched(db, id, {
    stargazers_count: 1,
    forks_count: 1,
    subscribers_count: 1,
    description: 'old',
    owner: 'team',
    owner_url: 'https://github.com/team',
    repo_name: 'repo',
    repo_updated: '2026-09-22T12:00:00Z',
    plugins_count: 3,
  })
  const getMarketplace = vi.fn(async () => ({ kind: 'found' as const, data: { plugins: [1, 2, 3, 4] } }))

  const counts = await enrichRepositories(db, reader(undefined, getMarketplace), 'crawl-1')

  expect(counts).toMatchObject({ updated: 1, newReady: 0, conclusive: 1 })
  expect(getMarketplace).not.toHaveBeenCalled()
  expect(db.prepare('SELECT description, stargazers_count, plugins_count, repo_updated FROM repositories WHERE id = ?').get(id)).toEqual({
    description: 'fresh',
    stargazers_count: 10,
    plugins_count: 3,
    repo_updated: '2026-09-22T12:00:00Z',
  })
})

it('canonicalizes a case-variant URL and merges an imported case-insensitive duplicate', async () => {
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
  db.prepare(`
    INSERT INTO repositories (id, html_url, createdAt, updatedAt)
    VALUES (500, 'https://github.com/team/repo', 'legacy-created', 'legacy-updated')
  `).run()
  ready(db, 500)
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
  expect(getMarketplace).toHaveBeenCalledWith('team', 'repo')
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
    if (name === 'repo') return { kind: 'temporary-error', status: 429, reason: 'GitHub rate limited' }
    if (name === 'other') return { kind: 'temporary-error', status: 200, reason: 'Invalid GitHub response' }
    return { kind: 'found', data: { plugins: [1, 2] } }
  })

  const counts = await enrichRepositories(db, client, 'crawl-1')

  expect(counts).toMatchObject({ unchangedOnError: 2, newReady: 1, conclusive: 1 })
  expect(ids.slice(0, 2).map((id) => db.prepare('SELECT * FROM repositories WHERE id = ?').get(id))).toEqual(before)
  expect(listRunErrors(db, 'crawl-1').map(({ repository_id, error_type }) => ({ repository_id, error_type }))).toEqual([
    { repository_id: ids[0], error_type: 'marketplace_rate_limited' },
    { repository_id: ids[1], error_type: 'marketplace_invalid_response' },
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
    reader(undefined, async () => ({ kind: 'temporary-error', status: 429, reason: 'GitHub rate limited' })),
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
    reader(async () => ({ kind: 'temporary-error', status: null, reason: 'GitHub network error' })),
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
      async () => ({ kind: 'temporary-error' as const, status: 429, reason: 'GitHub rate limited' }),
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
  expect(getRepository).toHaveBeenCalledWith('team', 'repo')
  expect(getMarketplace).toHaveBeenCalledTimes(1)
  expect(getMarketplace).toHaveBeenCalledWith('new-team', 'new-repo')
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
  expect(getRepository).toHaveBeenCalledWith('team', 'repo')
  expect(getMarketplace).toHaveBeenCalledTimes(1)
  expect(getMarketplace).toHaveBeenCalledWith('new-team', 'new-repo')
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
    reader(async () => ({ kind: 'temporary-error', status: 503, reason: 'GitHub server error' })),
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
})
