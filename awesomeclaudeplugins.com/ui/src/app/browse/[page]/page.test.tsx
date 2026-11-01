import { describe, expect, it, vi } from 'vitest'

const { searchCatalogRepos } = vi.hoisted(() => ({
  searchCatalogRepos: vi.fn(() => ({
    repos: [{ id: 1, owner: 'demo', repo_name: 'plugin' }],
    total: 1,
    hasMore: false,
    pluginsCount: 1,
  })),
}))

vi.mock('../../../lib/catalog.ts', () => ({
  getBrowsePageCount: () => 2,
  searchCatalogRepos,
}))

import BrowsePage from './page.tsx'

describe('browse page catalog access', () => {
  it('requests card-only data and avoids detail shards', async () => {
    await BrowsePage({ params: Promise.resolve({ page: '2' }) })
    expect(searchCatalogRepos).toHaveBeenCalledWith('', 'stars-desc', 1, 24, { summaries: 'omit' })
  })
})
