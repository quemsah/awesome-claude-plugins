import { describe, expect, it, vi } from 'vitest'

describe('catalog search index lifetime', () => {
  it('reuses one index when separate server bundles import catalog.ts', async () => {
    const key = Symbol.for('awesome-claude-plugins.catalog-search-index')
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
})
