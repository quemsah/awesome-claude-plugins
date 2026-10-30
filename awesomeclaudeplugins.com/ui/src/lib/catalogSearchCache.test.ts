import { beforeEach, describe, expect, it, vi } from 'vitest'

const { search } = vi.hoisted(() => ({ search: vi.fn(() => [] as never[]) }))

vi.mock('./fuzzySearch.ts', () => ({ createFuseIndex: () => ({ search }) }))

import { searchCatalogRepos } from './catalog.ts'

describe('catalog search cache', () => {
  beforeEach(() => {
    search.mockClear()
  })

  it('reuses one scan for every sort, page and spelling of a query', () => {
    searchCatalogRepos('superpowers', 'stars-desc', 0, 24)
    searchCatalogRepos('superpowers', 'forks-desc', 3, 24)
    searchCatalogRepos('  SuperPowers  ', 'plugins-desc', 0, 24)

    expect(search).toHaveBeenCalledTimes(1)
  })

  it('scans again for a different query', () => {
    searchCatalogRepos('context-mode', 'stars-desc', 0, 24)
    searchCatalogRepos('lean-playground', 'stars-desc', 0, 24)

    expect(search).toHaveBeenCalledTimes(2)
  })
})
