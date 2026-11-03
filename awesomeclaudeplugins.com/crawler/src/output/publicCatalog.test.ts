import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { updateEnriched, upsertDiscovery } from '../storage/repositories.js'
import { initializeSchema } from '../storage/schema.js'
import { buildPublicCatalogFromCrawler, formatPublicCatalogRecord } from './publicCatalog.js'

describe('publicCatalog', () => {
  let tempDir: string
  let db: Database.Database

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'public-catalog-test-'))
    db = new Database(':memory:')
    initializeSchema(db)
  })

  afterEach(() => {
    db.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('formats publishable repository row into PublicCatalogRecord', () => {
    const row = {
      id: 101,
      html_url: 'https://github.com/owner/my-plugin',
      stargazers_count: 50,
      forks_count: 5,
      subscribers_count: 3,
      description: 'A test plugin',
      owner: 'owner',
      owner_url: 'https://github.com/owner',
      repo_name: 'my-plugin',
      repo_updated: '2026-01-15T10:00:00Z',
      plugins_count: 2,
      plugins_json: JSON.stringify([{ name: 'sub-plugin', description: 'Sub desc' }]),
      manifest_kind: 'standalone-plugin' as const,
      catalog_updated_at: '2026-01-15T12:00:00.000Z',
      catalog_added_at: '2025-12-01T00:00:00.000Z',
      pushed_at: '2026-01-15T10:00:00.000Z',
      license: 'MIT',
      archived: 0,
      createdAt: '2025-12-01T00:00:00.000Z',
      updatedAt: '2026-01-15T12:00:00.000Z',
    }

    const formatted = formatPublicCatalogRecord(row)
    expect(formatted).toEqual({
      id: 101,
      stargazers_count: 50,
      forks_count: 5,
      subscribers_count: 3,
      description: 'A test plugin',
      owner: 'owner',
      repo_name: 'my-plugin',
      plugins_count: 2,
      plugins: [{ name: 'sub-plugin', description: 'Sub desc' }],
      manifest_kind: 'standalone-plugin',
      catalog_updated_at: '2026-01-15T12:00:00.000Z',
      pushed_at: '2026-01-15T10:00:00.000Z',
      catalog_added_at: '2025-12-01T00:00:00.000Z',
      license: 'MIT',
      archived: false,
    })
  })

  it('builds a public SQLite catalog from crawler database', () => {
    // Populate crawler db
    const id = upsertDiscovery(db, 'https://github.com/alice/plugin-a', null)
    updateEnriched(
      db,
      id,
      {
        owner: 'alice',
        owner_url: 'https://github.com/alice',
        repo_name: 'plugin-a',
        description: 'Alice plugin',
        stargazers_count: 12,
        forks_count: 2,
        subscribers_count: 1,
        repo_updated: '2026-02-01T00:00:00Z',
        plugins_count: 1,
        plugins_json: JSON.stringify([{ name: 'core', description: 'Alice core' }]),
        manifest_kind: 'standalone-plugin',
        license: 'Apache-2.0',
        archived: 0,
      },
      '2026-02-01T12:00:00.000Z',
    )

    db.prepare('INSERT INTO stats (id, date, size, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)').run(
      1,
      '2026-01-01T00:00:00.000Z',
      10,
      'now',
      'now',
    )

    const outputPath = join(tempDir, 'catalog.sqlite')
    const manifest = buildPublicCatalogFromCrawler(db, {
      outputPath,
      snapshotId: 'test-snapshot-1',
      draftStats: { id: 2, date: '2026-02-01T00:00:00.000Z', size: 1 },
      provenance: { test: true },
    })

    expect(manifest.snapshotId).toBe('test-snapshot-1')
    expect(manifest.recordCount).toBe(1)
    expect(manifest.canonicalCount).toBe(1)
    expect(manifest.statsCount).toBe(2)
    expect(manifest.artifactSha256).toMatch(/^[0-9a-f]{64}$/)

    // Inspect created SQLite DB
    const catalogDb = new Database(outputPath, { readonly: true })
    try {
      const meta = catalogDb.prepare('SELECT * FROM catalog_metadata WHERE id = 1').get() as Record<string, unknown>
      expect(meta.snapshot_id).toBe('test-snapshot-1')
      expect(meta.canonical_count).toBe(1)

      const repo = catalogDb.prepare('SELECT * FROM repositories WHERE id = ?').get(id) as Record<string, unknown>
      expect(repo.owner).toBe('alice')
      expect(repo.repo_name).toBe('plugin-a')
      expect(repo.is_canonical).toBe(1)

      const stats = catalogDb.prepare('SELECT * FROM statistics ORDER BY source_order').all()
      expect(stats).toHaveLength(2)
    } finally {
      catalogDb.close()
    }
  })

  it('rejects conflicting draft stats', () => {
    db.prepare('INSERT INTO stats (id, date, size, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)').run(
      5,
      '2026-03-01T00:00:00.000Z',
      20,
      'now',
      'now',
    )

    const outputPath = join(tempDir, 'conflict.sqlite')
    expect(() =>
      buildPublicCatalogFromCrawler(db, {
        outputPath,
        snapshotId: 'test-conflict',
        draftStats: { id: 5, date: '2026-03-02T00:00:00.000Z', size: 21 },
      }),
    ).toThrow(/already present/)
  })

  it('preserves exact serialization equivalence between renderRepos and formatPublicCatalogRecord', async () => {
    const { renderRepos } = await import('./catalogSnapshot.js')

    const edgeCases = [
      // Standard repo with multiple plugins
      {
        id: 1,
        html_url: 'https://github.com/alice/plugin-1',
        stargazers_count: 10,
        forks_count: 2,
        subscribers_count: 1,
        description: 'Standard plugin',
        owner: 'alice',
        owner_url: 'https://github.com/alice',
        repo_name: 'plugin-1',
        repo_updated: '2026-01-15T10:00:00Z',
        plugins_count: 2,
        plugins_json: JSON.stringify([
          { name: 'p1', description: 'desc 1' },
          { name: 'p2', description: 'desc 2' },
        ]),
        manifest_kind: 'marketplace' as const,
        catalog_updated_at: '2026-01-15T12:00:00.000Z',
        catalog_added_at: '2025-12-01T00:00:00.000Z',
        pushed_at: '2026-01-15T10:00:00.000Z',
        license: 'MIT',
        archived: 0,
      },
      // Description-only plugin: must NOT add name: ""
      {
        id: 2,
        html_url: 'https://github.com/bob/desc-only',
        stargazers_count: 5,
        forks_count: 0,
        subscribers_count: 0,
        description: null,
        owner: 'bob',
        owner_url: 'https://github.com/bob',
        repo_name: 'desc-only',
        repo_updated: '2026-01-15T10:00:00Z',
        plugins_count: 1,
        plugins_json: JSON.stringify([{ description: 'Summary with no plugin name' }]),
        manifest_kind: null,
        catalog_updated_at: '2026-01-15T12:00:00.000Z',
        catalog_added_at: null,
        pushed_at: null,
        license: null,
        archived: null,
      },
      // Missing catalog_updated_at: must NOT default to 1970
      {
        id: 3,
        html_url: 'https://github.com/charlie/no-updated',
        stargazers_count: 0,
        forks_count: 0,
        subscribers_count: 0,
        description: 'No updated timestamp',
        owner: 'charlie',
        owner_url: 'https://github.com/charlie',
        repo_name: 'no-updated',
        repo_updated: '2026-01-15T10:00:00Z',
        plugins_count: 0,
        plugins_json: null,
        manifest_kind: 'standalone-plugin' as const,
        catalog_updated_at: null,
        catalog_added_at: '2026-01-10T00:00:00.000Z',
        pushed_at: '2026-01-15T10:00:00.000Z',
        license: 'Apache-2.0',
        archived: true,
      },
    ]

    for (const row of edgeCases) {
      const legacyRendered = JSON.parse(renderRepos([row]))[0]
      const formatted = JSON.parse(JSON.stringify(formatPublicCatalogRecord(row)))
      expect(formatted).toEqual(legacyRendered)
    }

    const { calculateCatalogFingerprint } = await import('@awesome-claude-plugins/catalog-snapshot')
    const legacyParsed = JSON.parse(renderRepos(edgeCases))
    const formattedRecords = edgeCases.map((row) => formatPublicCatalogRecord(row))
    expect(calculateCatalogFingerprint(formattedRecords)).toBe(calculateCatalogFingerprint(legacyParsed))
  })
})
