import { describe, expect, it } from 'vitest'
import { getCatalog, getRepoDetails, hydrateCatalogRepo, parseSearchIndex } from './catalogStore.ts'

describe('catalogStore', () => {
  it('restores exact card descriptions and manifest kind from v1 compact rows', () => {
    const example = {
      format: 'v1' as const,
      fields: ['id', 'owner', 'repo_name', 'description', 'manifest_kind'],
      search: '',
      rows: [
        [
          123,
          'example',
          'demo',
          12,
          3,
          5,
          null,
          'MIT',
          false,
          null,
          2,
          null,
          'Correct visible description of a plugin repository.',
          'standalone-plugin',
        ],
      ],
    }
    const parsed = parseSearchIndex(example)
    expect(parsed).toEqual([
      expect.objectContaining({
        id: 123,
        description: 'Correct visible description of a plugin repository.',
        manifest_kind: 'standalone-plugin',
        plugins_count: 5,
      }),
    ])
    expect(Object.keys(parsed[0])).not.toContain('searchRow')
    expect(JSON.stringify(parsed[0])).not.toContain('searchRow')
  })

  it('does not return another repository when the supplied identity disagrees', () => {
    const first = getCatalog()[0]
    expect(getRepoDetails(first.id, first.owner, first.repo_name)?.id).toBe(first.id)
    expect(getRepoDetails(first.id, 'definitely-not-the-owner', first.repo_name)).toBeNull()
  })

  it('recovers original metadata when a cached shard has no entry', () => {
    const first = getCatalog()[0]
    const key = Symbol.for('awesome-claude-plugins.shard-cache')
    const root = globalThis as unknown as Record<symbol, unknown>
    const previous = root[key]
    try {
      root[key] = new Map([[Math.abs(first.id % 100), {}]])
      const restored = getRepoDetails(first.id, first.owner, first.repo_name)
      expect(restored).not.toBeNull()
      expect(restored?.owner).toBe(first.owner)
      expect(restored?.repo_name).toBe(first.repo_name)
      expect(restored?.description).not.toBe('Description available.')
    } finally {
      if (previous === undefined) delete root[key]
      else root[key] = previous
    }
  })

  it('keeps the most recently used shard in the bounded LRU', () => {
    const cacheKey = Symbol.for('awesome-claude-plugins.shard-cache')
    const holder = globalThis as unknown as Record<symbol, unknown>
    const previous = holder[cacheKey]
    const records = new Map<number, (ReturnType<typeof getCatalog>)[number]>()
    for (const repo of getCatalog()) {
      const shardId = Math.abs(repo.id % 100)
      if (!records.has(shardId)) records.set(shardId, repo)
      if (records.size === 12) break
    }
    const samples = [...records.values()]
    expect(samples).toHaveLength(12)
    try {
      delete holder[cacheKey]
      for (const repo of samples.slice(0, 10)) getRepoDetails(repo.id, repo.owner, repo.repo_name)
      // Touch the first inserted shard; it should survive subsequent evictions.
      getRepoDetails(samples[0].id, samples[0].owner, samples[0].repo_name)
      for (const repo of samples.slice(10)) getRepoDetails(repo.id, repo.owner, repo.repo_name)
      const cache = holder[cacheKey] as Map<number, unknown>
      expect(cache.size).toBe(10)
      expect(cache.has(Math.abs(samples[0].id % 100))).toBe(true)
      expect(cache.has(Math.abs(samples[1].id % 100))).toBe(false)
    } finally {
      if (previous === undefined) delete holder[cacheKey]
      else holder[cacheKey] = previous
    }
  })

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
    const details = getRepoDetails(first.id, first.owner, first.repo_name)
    expect(details).not.toBeNull()
    expect(hydrated.description).toBe(details?.description ?? null)
  })
})
