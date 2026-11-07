/** biome-ignore-all lint/style/useNamingConvention: test fixtures mirror catalog snake_case fields */

import { describe, expect, it, vi } from 'vitest'

vi.unmock('./catalogStore.ts')

import { getCatalog, getRepoDetails, hydrateCatalogRepo } from './catalogStore.ts'

describe('catalogStore', () => {
  it('does not return another repository when the supplied identity disagrees', async () => {
    const { getSqliteReader } = await import('./sqliteCatalogStore.ts')
    const reader = getSqliteReader()
    const [first] = reader.iteratePublishedRecords()
    expect(first).toBeDefined()
    expect(getRepoDetails(first.id, first.owner, first.repo_name)?.id).toBe(first.id)
    expect(getRepoDetails(first.id, 'definitely-not-the-owner', first.repo_name)).toBeNull()
  })

  it('delegates repo details lookup directly to sqlite reader', async () => {
    const { getSqliteReader } = await import('./sqliteCatalogStore.ts')
    const reader = getSqliteReader()
    const [first] = reader.iteratePublishedRecords()
    const details = getRepoDetails(first.id, first.owner, first.repo_name)
    expect(details).not.toBeNull()
    expect(details?.id).toBe(first.id)
    expect(details?.owner).toBe(first.owner)
    expect(details?.repo_name).toBe(first.repo_name)
  })

  it('rejects unbounded getCatalog() full materialization when fixture is not configured', () => {
    const prev = process.env.CATALOG_DATA_PATH
    delete process.env.CATALOG_DATA_PATH
    try {
      expect(() => getCatalog()).toThrow('Unbounded full catalog materialization is disabled')
    } finally {
      if (prev !== undefined) process.env.CATALOG_DATA_PATH = prev
    }
  })

  it('preserves complete SQLite records and caller-added fields during hydration', async () => {
    const { getSqliteReader } = await import('./sqliteCatalogStore.ts')
    const reader = getSqliteReader()
    const [first] = reader.iteratePublishedRecords()
    const augmented = { ...first, callerAdded: true }
    const hydrated = hydrateCatalogRepo(augmented)

    expect(hydrated).toBe(augmented)
    expect(hydrated.callerAdded).toBe(true)
  })
})
