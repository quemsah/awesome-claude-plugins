/** biome-ignore-all lint/style/useNamingConvention: Fixture mirrors catalog field names. */

import { describe, expect, it, vi } from 'vitest'

const { fixtureRepos } = vi.hoisted(() => ({
  fixtureRepos: [
    {
      id: 999_001,
      html_url: 'https://github.com/catalog-fixture/generic-toolkit',
      owner: 'catalog-fixture',
      owner_url: 'https://github.com/catalog-fixture',
      repo_name: 'generic-toolkit',
      description: 'A collection of developer tools',
      stargazers_count: 9,
      forks_count: 2,
      subscribers_count: 1,
      plugins_count: 1,
      plugins: [{ name: 'zerogravityplugin', description: 'aurora system diagnostics' }],
    },
    {
      id: 999_002,
      html_url: 'https://github.com/catalog-fixture/large-marketplace',
      owner: 'catalog-fixture',
      owner_url: 'https://github.com/catalog-fixture',
      repo_name: 'large-marketplace',
      description: 'A large marketplace with many plugins',
      stargazers_count: 5,
      forks_count: 1,
      subscribers_count: 1,
      plugins_count: 50,
      plugins: Array.from({ length: 50 }, (_, i) => ({
        name: i === 30 ? 'thirtyfirstplugin' : i === 49 ? 'fiftiethplugin' : `plugin-${i + 1}`,
        description:
          i === 30
            ? 'unique thirty-first plugin capability'
            : i === 49
              ? 'unique fiftieth plugin capability'
              : `description for plugin ${i + 1}`,
      })),
    },
    ...Array.from({ length: 24 }, (_, i) => ({
      id: 999_100 + i,
      html_url: `https://github.com/cache-fixture/cache-entry-${i}`,
      owner: 'cache-fixture',
      owner_url: 'https://github.com/cache-fixture',
      repo_name: `cache-entry-${i}`,
      description: 'repeated-cache-fixture',
      stargazers_count: 100 - i,
      forks_count: 1,
      subscribers_count: 1,
      plugins_count: 1,
      plugins: [{ name: 'cached-plugin' }],
    })),
  ],
}))

vi.mock('../../../lib/catalogStore.ts', () => ({
  getCatalog: () => fixtureRepos,
  getRepoDetails: (id: number) => fixtureRepos.find((r) => r.id === id) ?? null,
  hydrateCatalogRepo: hydrateSpy,
  isSearchCatalogRepo: (_repo: unknown): boolean => false,
  readCatalogSearchFields: () => [],
}))

const { hydrateSpy } = vi.hoisted(() => ({ hydrateSpy: vi.fn((repo: unknown) => repo) }))

import { searchCatalogRepos } from '../../../lib/catalog.ts'
import { GET } from './route.ts'

type Plugin = { description?: string; name?: string }
type CatalogRepo = { id: number; owner: string | null; plugins?: Plugin[]; repo_name: string | null }
type CatalogPayload = { hasMore: boolean; pluginsCount: number; repos: CatalogRepo[]; total: number }

const expectedRepo: CatalogRepo = {
  id: 999_001,
  owner: 'catalog-fixture',
  repo_name: 'generic-toolkit',
  plugins: [{ name: 'zerogravityplugin', description: 'aurora system diagnostics' }],
}

async function apiSearch(query: string, view?: 'cards'): Promise<CatalogPayload> {
  const url = new URL('http://localhost/api/catalog')
  url.searchParams.set('q', query)
  url.searchParams.set('pageSize', '10')
  if (view) url.searchParams.set('view', view)
  const response = await GET(new Request(url, { headers: { 'x-real-ip': `plugin-search-${query}` } }))

  if (!response.ok) throw new Error(`/api/catalog returned ${response.status}`)
  return (await response.json()) as CatalogPayload
}

function serverSearch(query: string): CatalogPayload {
  const result = searchCatalogRepos(query, 'stars-desc', 0, 10)
  return { hasMore: result.hasMore, pluginsCount: result.pluginsCount, repos: result.repos, total: result.total }
}

describe('/api/catalog plugin metadata search', () => {
  it('reuses complete pages spanning 24 shards and bounds its page cache', () => {
    const key = Symbol.for('awesome-claude-plugins.full-catalog-page-cache')
    const root = globalThis as unknown as Record<symbol, unknown>
    const previous = root[key]
    try {
      delete root[key]
      hydrateSpy.mockClear()
      const query = 'repeated-cache-fixture'
      const initial = searchCatalogRepos(query, 'stars-desc', 0, 24)
      expect(initial.repos).toHaveLength(24)
      expect(new Set(initial.repos.map((repo) => repo.id % 100)).size).toBe(24)
      expect(hydrateSpy).toHaveBeenCalledTimes(24)
      expect(searchCatalogRepos(query, 'stars-desc', 0, 24)).toEqual(initial)
      expect(hydrateSpy).toHaveBeenCalledTimes(24)

      for (const sort of ['forks-desc', 'plugins-desc', 'updated-desc'] as const) {
        searchCatalogRepos(query, sort, 0, 24)
      }
      const cache = root[key] as { pages: Map<string, unknown> }
      expect(cache.pages.size).toBe(3)
      searchCatalogRepos(query, 'stars-desc', 0, 24)
      expect(hydrateSpy).toHaveBeenCalledTimes(120)
    } finally {
      if (previous === undefined) delete root[key]
      else root[key] = previous
    }
  })

  it('does not load full detail shards for card-only API responses', async () => {
    hydrateSpy.mockClear()
    const cards = await apiSearch('zerogravityplugin', 'cards')
    expect(cards.total).toBe(1)
    expect(hydrateSpy).not.toHaveBeenCalled()
    expect(cards.repos[0].plugins).toBeUndefined()
  })

  it.each([
    ['zerogravityplugin', 'plugin name'],
    ['aurora system diagnostics', 'plugin description'],
  ])('finds the exact repository by %s appearing only in its %s', async (query) => {
    const server = serverSearch(query)
    const api = await apiSearch(query)

    expect(server.total).toBe(1)
    expect(server.repos).toHaveLength(1)
    expect(server.repos.map(({ id, owner, repo_name, plugins }) => ({ id, owner, repo_name, plugins }))).toEqual([expectedRepo])
    expect(api).toEqual(server)
    expect(api.repos.map(({ id, owner, repo_name, plugins }) => ({ id, owner, repo_name, plugins }))).toEqual([expectedRepo])
  })

  it('returns compact card payloads while still matching descriptions beyond 30 plugins', async () => {
    const query = 'unique fiftieth plugin capability'
    const full = await apiSearch(query)
    const cards = await apiSearch(query, 'cards')
    const serverCards = searchCatalogRepos(query, 'stars-desc', 0, 10, { summaries: 'omit' })

    expect(cards).toEqual(serverCards)
    expect(cards.total).toBe(1)
    expect(cards.repos[0]?.id).toBe(999_002)
    expect(cards.repos[0]?.plugins).toBeUndefined()
    expect(full.repos[0]?.plugins).toHaveLength(50)
    expect(JSON.stringify(cards).length).toBeLessThan(JSON.stringify(full).length)
  })

  it.each([
    ['thirtyfirstplugin', '31st plugin name'],
    ['unique thirty-first plugin capability', '31st plugin description'],
    ['fiftiethplugin', '50th plugin name'],
    ['unique fiftieth plugin capability', '50th plugin description'],
  ])('finds parent repository by %s (%s) beyond initial 30 plugins', async (query) => {
    const server = serverSearch(query)
    const api = await apiSearch(query)

    expect(server.total).toBe(1)
    expect(server.repos).toHaveLength(1)
    expect(server.repos[0]?.id).toBe(999_002)
    expect(server.repos[0]?.repo_name).toBe('large-marketplace')
    expect(api).toEqual(server)
  })
})
