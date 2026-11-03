/** biome-ignore-all lint/style/useNamingConvention: test fixtures mirror catalog snake_case fields */

import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('./catalogStore.ts')

import {
  getCatalog,
  getRepoDetails,
  hydrateCatalogRepo,
  parseSearchIndex,
  readCatalogFiles,
  readCatalogSearchFields,
  SEARCH_INDEX_FIELDS,
} from './catalogStore.ts'

describe('catalogStore', () => {
  it('restores exact card descriptions and manifest kind from v1 compact rows', () => {
    const example = {
      format: 'v1' as const,
      fields: [...SEARCH_INDEX_FIELDS],
      search: 'compressed-metadata',
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

  it('rejects reordered V1 fields and truncated or incomplete records', () => {
    const row = [123, 'sample', 'repo', 1, 0, 2, null, null, false, null, 1, null, 'original description', 'marketplace']
    const index = { format: 'v1' as const, fields: [...SEARCH_INDEX_FIELDS], rows: [row], search: 'compressed-metadata' }
    expect(parseSearchIndex(index)[0].description).toBe('original description')

    const reordered = { ...index, fields: [...index.fields] }
    ;[reordered.fields[12], reordered.fields[13]] = [reordered.fields[13], reordered.fields[12]]
    expect(() => parseSearchIndex(reordered)).toThrow('Incompatible compact catalog format')
    expect(() => parseSearchIndex({ ...index, fields: index.fields.slice(0, -1) })).toThrow()
    expect(() => parseSearchIndex({ ...index, rows: [row.slice(0, -1)] })).toThrow()
    expect(() => parseSearchIndex({ ...index, search: '' })).toThrow()
  })

  it('loads canonical data when a compact index is corrupt or incompatible', () => {
    const folder = mkdtempSync(join(tmpdir(), 'catalog-fallback-'))
    const indexPath = join(folder, 'search-index.json')
    const reposPath = join(folder, 'repos.json')
    const canonical = [{ id: 234, owner: 'fresh', repo_name: 'repo', description: 'Current canonical description' }]
    try {
      writeFileSync(reposPath, JSON.stringify(canonical))
      writeFileSync(indexPath, '{broken JSON')
      const restored = readCatalogFiles(indexPath, reposPath)
      expect(restored).toEqual(canonical)
      expect(hydrateCatalogRepo(restored[0])).toBe(restored[0])

      writeFileSync(indexPath, JSON.stringify({ format: 'v1', fields: ['id'], rows: [[234]], search: 'invalid' }))
      expect(readCatalogFiles(indexPath, reposPath)).toEqual(canonical)
      rmSync(reposPath)
      expect(() => readCatalogFiles(indexPath, reposPath)).toThrow('no canonical repository snapshot')
      rmSync(indexPath)
      expect(() => readCatalogFiles(indexPath, reposPath)).toThrow('Missing compact catalog and canonical repository snapshot')
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  it('falls back to the canonical data when the index was built from another snapshot with the same number of rows', () => {
    const folder = mkdtempSync(join(tmpdir(), 'catalog-mismatch-'))
    const indexPath = join(folder, 'search-index.json')
    const reposPath = join(folder, 'repos.json')
    const oldCanonical = JSON.stringify([{ id: 123, owner: 'old', repo_name: 'sample' }])
    const freshCanonical = [{ id: 123, owner: 'fresh', repo_name: 'sample' }]
    const index = {
      format: 'v1' as const,
      fields: [...SEARCH_INDEX_FIELDS],
      rows: [[123, 'old', 'sample', 1, 0, null, null, null, false, null, 1, null, 'Old details', null]],
      search: gzipSync(JSON.stringify([{}])).toString('base64'),
      canonicalSha256: createHash('sha256').update(oldCanonical).digest('hex'),
    }

    try {
      writeFileSync(indexPath, JSON.stringify(index))
      writeFileSync(reposPath, oldCanonical)
      expect(readCatalogFiles(indexPath, reposPath)[0].owner).toBe('old')

      writeFileSync(reposPath, JSON.stringify(freshCanonical))
      expect(readCatalogFiles(indexPath, reposPath)).toEqual(freshCanonical)
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  it('recovers corrupt gzip search metadata without losing plugin names', () => {
    const folder = mkdtempSync(join(tmpdir(), 'catalog-search-fallback-'))
    const indexPath = join(folder, 'search-index.json')
    const reposPath = join(folder, 'repos.json')
    const canonical = [{ id: 123, owner: 'sample', repo_name: 'repo', plugins: [{ name: 'special-plugin' }] }]
    const index = {
      format: 'v1',
      fields: [...SEARCH_INDEX_FIELDS],
      rows: [[123, 'sample', 'repo', 1, 0, 1, null, null, false, null, 0, null, null, 'marketplace']],
      search: gzipSync(JSON.stringify([])).toString('base64'),
    }
    try {
      writeFileSync(reposPath, JSON.stringify(canonical))
      const searchFields = [{ plugins: [{ name: 'special-plugin' }] }]
      writeFileSync(indexPath, JSON.stringify({ ...index, search: gzipSync(JSON.stringify(searchFields)).toString('base64') }))
      expect(readCatalogSearchFields(indexPath, reposPath, 1)).toEqual(searchFields)
      writeFileSync(indexPath, JSON.stringify(index))
      expect(readCatalogSearchFields(indexPath, reposPath, 1)).toEqual(canonical)
      writeFileSync(indexPath, JSON.stringify({ ...index, search: 'invalid-gzip' }))
      expect(readCatalogSearchFields(indexPath, reposPath, 1)).toEqual(canonical)
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  it('does not return another repository when the supplied identity disagrees', async () => {
    const { getSqliteReader } = await import('./sqliteCatalogStore.ts')
    const reader = getSqliteReader()
    const first = reader.iteratePublishedRecords().next().value
    expect(first).toBeDefined()
    expect(getRepoDetails(first.id, first.owner, first.repo_name)?.id).toBe(first.id)
    expect(getRepoDetails(first.id, 'definitely-not-the-owner', first.repo_name)).toBeNull()
  })

  it('delegates repo details lookup directly to sqlite reader', async () => {
    const { getSqliteReader } = await import('./sqliteCatalogStore.ts')
    const reader = getSqliteReader()
    const first = reader.iteratePublishedRecords().next().value
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

  it('hydrates repo details on demand with full description and plugins from sqlite', async () => {
    const { getSqliteReader } = await import('./sqliteCatalogStore.ts')
    const reader = getSqliteReader()
    const first = reader.iteratePublishedRecords().next().value
    const hydrated = hydrateCatalogRepo(first)

    expect(hydrated.id).toBe(first.id)
    expect(hydrated.owner).toBe(first.owner)
    expect(hydrated.repo_name).toBe(first.repo_name)
    const details = getRepoDetails(first.id, first.owner, first.repo_name)
    expect(details).not.toBeNull()
    expect(hydrated.description).toBe(details?.description ?? null)
  })
})
