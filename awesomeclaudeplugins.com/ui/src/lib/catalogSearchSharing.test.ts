import { describe, expect, it, vi } from 'vitest'

describe('catalog search index lifetime', () => {
  it('reuses one index when separate server bundles import catalog.ts', async () => {
    const key = Symbol.for('awesome-claude-plugins.sqlite-catalog-reader')
    const holder = globalThis as unknown as Record<symbol, unknown>
    const previous = holder[key]
    try {
      delete holder[key]
      vi.resetModules()
      const first = await import('./catalog.ts')
      const total = first.searchCatalogRepos('superpowers', 'stars-desc').total
      const entry = holder[key]
      expect(entry).toBeDefined()

      vi.resetModules()
      const second = await import('./catalog.ts')
      expect(second.searchCatalogRepos('superpowers', 'stars-desc').total).toBe(total)
      expect(holder[key]).toBe(entry)
    } finally {
      if (previous === undefined) delete holder[key]
      else holder[key] = previous
      vi.resetModules()
    }
  })
  it('keeps non-searchable queries empty without loading SQLite', async () => {
    const key = Symbol.for('awesome-claude-plugins.sqlite-catalog-reader')
    const holder = globalThis as unknown as Record<symbol, unknown>
    const previous = holder[key]
    try {
      delete holder[key]
      vi.resetModules()
      const { searchCatalogRepos } = await import('./catalog.ts')
      const { hasSearchableTerms } = await import('./fuzzySearch.ts')

      for (const query of ['c', 'c?', '?', '!!!', '   !!!   ', '+', '#']) {
        expect(hasSearchableTerms(query.trim().toLowerCase())).toBe(false)
        expect(searchCatalogRepos(query, 'stars-desc')).toMatchObject({
          repos: [],
          total: 0,
          pluginsCount: 0,
          hasMore: false,
        })
        expect(holder[key]).toBeUndefined()
      }

      for (const query of ['c++', 'C#', '#devtools', 'claude c']) {
        expect(hasSearchableTerms(query)).toBe(true)
      }
      searchCatalogRepos('claude c', 'stars-desc')
      expect(holder[key]).toBeDefined()
    } finally {
      if (previous === undefined) delete holder[key]
      else holder[key] = previous
      vi.resetModules()
    }
  })
})
