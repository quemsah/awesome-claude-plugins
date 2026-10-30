/** biome-ignore-all lint/style/useNamingConvention: Fixture mirrors catalog field names. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  ],
}))

vi.mock('../../../lib/catalogStore.ts', () => ({ getCatalog: () => fixtureRepos }))

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

beforeEach(() => {
  const holder = globalThis as typeof globalThis & { catalogSearchMatchesCache?: Map<string, unknown> }
  holder.catalogSearchMatchesCache?.clear()
})

async function apiSearch(query: string): Promise<CatalogPayload> {
  const url = new URL('http://localhost/api/catalog')
  url.searchParams.set('q', query)
  url.searchParams.set('pageSize', '10')
  const response = await GET(new Request(url, { headers: { 'x-real-ip': `plugin-search-${query}` } }))

  if (!response.ok) throw new Error(`/api/catalog returned ${response.status}`)
  return (await response.json()) as CatalogPayload
}

function serverSearch(query: string): CatalogPayload {
  const result = searchCatalogRepos(query, 'stars-desc', 0, 10)
  return { hasMore: result.hasMore, pluginsCount: result.pluginsCount, repos: result.repos, total: result.total }
}

describe('/api/catalog plugin metadata search', () => {
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
})
