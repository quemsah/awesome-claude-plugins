import { describe, expect, it } from 'vitest'
import { searchCatalogRepos } from '../../../lib/catalog.ts'
import { CATALOG_PAGE_SIZE } from '../../../lib/catalogPagination.ts'
import { MAX_QUERY_LENGTH } from '../../../lib/searchQuery.ts'
import { GET } from './route.ts'

type CatalogPayload = {
  hasMore: boolean
  pluginsCount: number
  repos: { id: number }[]
  total: number
}

/** What the browser receives when it pages through results. */
async function apiCatalog(query: string, page: number): Promise<CatalogPayload> {
  const url = new URL('http://localhost/api/catalog')
  url.searchParams.set('q', query)
  url.searchParams.set('sort', 'stars-desc')
  url.searchParams.set('page', `${page}`)
  url.searchParams.set('pageSize', `${CATALOG_PAGE_SIZE}`)

  const response = await GET(new Request(url, { headers: { 'x-real-ip': `catalog-parity-${page}` } }))

  if (!response.ok) {
    throw new Error(`/api/catalog responded ${response.status} for ${JSON.stringify(query)}`)
  }

  return (await response.json()) as CatalogPayload
}

/** What the server puts into the first render of `/`. */
function serverRender(query: string, page: number): CatalogPayload {
  const result = searchCatalogRepos(query, 'stars-desc', page, CATALOG_PAGE_SIZE)
  return { hasMore: result.hasMore, pluginsCount: result.pluginsCount, repos: [...result.repos], total: result.total }
}

// Building the Fuse index and sorting the catalog costs seconds per query, so these stay well
// above the default 5s test timeout.
describe('/api/catalog parity with the server initial render', { timeout: 120_000 }, () => {
  it.each([
    ['hyphenated', 'claude-plugin'],
    ['hyphenated multi-word', 'claude-code review-plugin'],
    ['special characters', 'code-review'],
    ['at the pattern limit', 'x'.repeat(MAX_QUERY_LENGTH)],
    ['beyond the pattern limit', 'anthropic claude code plugin marketplace'],
    ['padded beyond the pattern limit', `   ${'claude-plugins-for-production-deployments'}`],
  ])('returns the same count and order for %s query %j', async (_label, query) => {
    const server = serverRender(query, 0)
    const api = await apiCatalog(query, 0)

    expect(api).toMatchObject({ pluginsCount: server.pluginsCount, total: server.total })
    expect(api.repos.map((repo) => repo.id)).toEqual(server.repos.map((repo) => repo.id))
  })

  it('keeps the page indicator stable beyond the pattern limit', async () => {
    const query = 'anthropic claude code plugin marketplace'
    const initial = serverRender(query, 0)
    const paged = await apiCatalog(query, 1)

    expect(paged.hasMore).toBe(initial.hasMore)
    expect(Math.ceil(paged.total / CATALOG_PAGE_SIZE)).toBe(Math.ceil(initial.total / CATALOG_PAGE_SIZE))
  })
})
