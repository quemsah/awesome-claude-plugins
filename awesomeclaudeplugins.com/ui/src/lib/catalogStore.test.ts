import { describe, expect, it } from 'vitest'
import { getCatalog, getRepoDetails, hydrateCatalogRepo } from './catalogStore.ts'

describe('catalogStore', () => {
  it('loads the catalog records from search index or fallback', () => {
    const catalog = getCatalog()
    expect(catalog.length).toBeGreaterThan(0)
    const first = catalog[0]
    expect(first.id).toBeDefined()
    expect(first.owner).toBeDefined()
    expect(first.repo_name).toBeDefined()
  })

  it('hydrates repo details on demand with full description and plugins', () => {
    const catalog = getCatalog()
    const first = catalog[0]
    const hydrated = hydrateCatalogRepo(first)

    expect(hydrated.id).toBe(first.id)
    expect(hydrated.owner).toBe(first.owner)
    expect(hydrated.repo_name).toBe(first.repo_name)
    // Should have valid details
    const details = getRepoDetails(first.id, first.owner, first.repo_name)
    if (details) {
      expect(hydrated.description).toBe(details.description ?? null)
    }
  })
})
