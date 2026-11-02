import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { buildPublicCatalog } from '../src/build.js'
import {
  CorruptedSnapshotError,
  IncompatibleSchemaError,
  InvalidSnapshotInputError,
  MarkdownPathCollisionError,
  SnapshotMismatchError,
} from '../src/errors.js'
import { openPublicCatalog } from '../src/read.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const fixturesDir = join(__dirname, '../../fixtures/catalog-snapshot/v1')
const inputRepos = JSON.parse(readFileSync(join(fixturesDir, 'input-repos.json'), 'utf8'))
const inputStats = JSON.parse(readFileSync(join(fixturesDir, 'input-stats.json'), 'utf8'))

const tempDbPath = join(__dirname, 'test-reader-and-validation.sqlite')

describe('readerAndValidation', () => {
  after(() => {
    try {
      rmSync(tempDbPath, { force: true })
    } catch {}
  })

  it('rejects invalid inputs to builder', () => {
    assert.throws(() => buildPublicCatalog(null, tempDbPath), InvalidSnapshotInputError)
    assert.throws(() => buildPublicCatalog({}, tempDbPath), InvalidSnapshotInputError)
    assert.throws(
      () => buildPublicCatalog({ records: [], stats: [], snapshotId: '' }, tempDbPath),
      InvalidSnapshotInputError
    )
    assert.throws(
      () => buildPublicCatalog({ records: [], stats: [], snapshotId: 'valid' }, ''),
      InvalidSnapshotInputError
    )
  })

  it('validates expected schema, snapshot ID, and fingerprint in openPublicCatalog', () => {
    const manifest = buildPublicCatalog(
      {
        records: inputRepos,
        stats: inputStats,
        snapshotId: 'validated-run-1',
      },
      tempDbPath
    )

    // Expected matching criteria succeeds
    const reader = openPublicCatalog(tempDbPath, {
      schemaVersion: 1,
      snapshotId: 'validated-run-1',
      catalogFingerprint: manifest.catalogFingerprint,
    })
    assert.ok(reader)
    reader.close()

    // Schema version mismatch throws IncompatibleSchemaError
    assert.throws(
      () => openPublicCatalog(tempDbPath, { schemaVersion: 999 }),
      IncompatibleSchemaError
    )

    // Default openPublicCatalog without expected options still validates reader supported schema version
    const testDb = new Database(tempDbPath)
    try {
      testDb.prepare('UPDATE catalog_metadata SET schema_version = 99 WHERE id = 1').run()
    } finally {
      testDb.close()
    }
    assert.throws(
      () => openPublicCatalog(tempDbPath),
      IncompatibleSchemaError
    )

    // Restore schema version for following tests
    const restoreDb = new Database(tempDbPath)
    try {
      restoreDb.prepare('UPDATE catalog_metadata SET schema_version = 1 WHERE id = 1').run()
    } finally {
      restoreDb.close()
    }

    // Snapshot ID mismatch throws SnapshotMismatchError
    assert.throws(
      () => openPublicCatalog(tempDbPath, { snapshotId: 'different-id' }),
      SnapshotMismatchError
    )

    // Fingerprint mismatch throws SnapshotMismatchError
    assert.throws(
      () => openPublicCatalog(tempDbPath, { catalogFingerprint: '00000000000000000000000000000000' }),
      SnapshotMismatchError
    )

    // Non-existent file throws CorruptedSnapshotError
    assert.throws(
      () => openPublicCatalog(join(__dirname, 'does-not-exist.sqlite')),
      CorruptedSnapshotError
    )
  })

  it('provides markdown checking, SEO iteration, and statistics iteration', () => {
    buildPublicCatalog(
      {
        records: inputRepos,
        stats: inputStats,
        snapshotId: 'projections-run',
      },
      tempDbPath
    )

    const reader = openPublicCatalog(tempDbPath)
    try {
      // Literal markdown repo check
      assert.equal(reader.isLiteralMarkdownRepo('doc-org/awesome-guide.md'), true)
      assert.equal(reader.isLiteralMarkdownRepo('DOC-ORG/AWESOME-GUIDE.MD'), true)
      assert.equal(reader.isLiteralMarkdownRepo('standard-org/standard-plugin'), false)
      assert.equal(reader.isLiteralMarkdownRepo('unknown/repo.md'), false)

      // Indexable repos iteration
      const indexable = Array.from(reader.iterateIndexableRepos(2))
      assert.ok(indexable.length > 0)
      assert.ok(indexable.some((r) => r.path === 'doc-org/awesome-guide.md'))

      // Statistics iteration
      const stats = Array.from(reader.iterateStatistics(2))
      assert.equal(stats.length, inputStats.length)
      assert.deepEqual(stats, inputStats)

      // Browse with different sorts
      for (const sort of ['stars-desc', 'forks-desc', 'plugins-desc', 'updated-desc', 'created-desc']) {
        const page = reader.getBrowsePage({ sort, page: 0, pageSize: 5 })
        assert.ok(page.matches.length > 0)
      }
    } finally {
      reader.close()
    }
  })

  it('normalizes fractional, negative, and nonfinite pagination inputs safely', () => {
    buildPublicCatalog(
      {
        records: inputRepos,
        stats: inputStats,
        snapshotId: 'pagination-norm-run',
      },
      tempDbPath
    )

    const reader = openPublicCatalog(tempDbPath)
    try {
      // Nonfinite, negative, and fractional page and pageSize in getBrowsePage
      const browseDefault = reader.getBrowsePage({})
      const browseNegative = reader.getBrowsePage({ page: -5, pageSize: -10 })
      assert.equal(browseNegative.matches.length, 1) // pageSize min is 1
      assert.deepEqual(browseNegative.matches[0], browseDefault.matches[0])

      const browseFractional = reader.getBrowsePage({ page: 0.9, pageSize: 2.8 })
      assert.equal(browseFractional.matches.length, 2) // truncated to 2

      const browseNonfinite = reader.getBrowsePage({ page: NaN, pageSize: Infinity })
      assert.equal(browseNonfinite.matches.length, browseDefault.matches.length) // fallback to 24, returning all 6 available items

      // Very large finite numbers (overflowing int64 / producing Infinity in page * pageSize)
      const browseHuge = reader.getBrowsePage({ page: 1e308, pageSize: 1e20 })
      assert.equal(browseHuge.matches.length, 0)

      // searchRepos pagination normalization
      const searchNorm = reader.searchRepos('plugin', { page: -1, pageSize: NaN })
      assert.ok(searchNorm.matches.length > 0)
      const searchHuge = reader.searchRepos('plugin', { page: 1e308, pageSize: 1e20 })
      assert.equal(searchHuge.matches.length, 0)

      // iterators batchSize normalization
      const published = Array.from(reader.iteratePublishedRecords(0.5))
      assert.equal(published.length, inputRepos.length)

      const indexable = Array.from(reader.iterateIndexableRepos(NaN))
      assert.ok(indexable.length > 0)

      const stats = Array.from(reader.iterateStatistics(-10))
      assert.equal(stats.length, inputStats.length)
    } finally {
      reader.close()
    }
  })

  it('reuses existing snapshot only when records and statistics match', () => {
    const m1 = buildPublicCatalog(
      {
        records: inputRepos,
        stats: inputStats,
        snapshotId: 'reuse-test-run',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      tempDbPath
    )

    // Identical records and stats -> reuses existing snapshot
    const m2 = buildPublicCatalog(
      {
        records: inputRepos,
        stats: inputStats,
        snapshotId: 'reuse-test-run',
        createdAt: '2026-02-02T00:00:00.000Z', // Different createdAt, should return existing
      },
      tempDbPath
    )
    assert.equal(m2.createdAt, '2026-01-01T00:00:00.000Z')
    assert.equal(m2.artifactSha256, m1.artifactSha256)

    // Changed stats with SAME snapshotId -> throws SnapshotMismatchError (immutability protection)
    const changedStats = [{ id: 99999, date: '2026-03-03', size: 12345 }]
    assert.throws(
      () =>
        buildPublicCatalog(
          {
            records: inputRepos,
            stats: changedStats,
            snapshotId: 'reuse-test-run',
            createdAt: '2026-03-03T00:00:00.000Z',
          },
          tempDbPath
        ),
      SnapshotMismatchError
    )

    // Non-array iterable (generator) with SAME snapshotId -> throws SnapshotMismatchError because reuse cannot be verified
    function* generateRecords() {
      for (const r of inputRepos) yield r
    }
    assert.throws(
      () =>
        buildPublicCatalog(
          {
            records: generateRecords(),
            stats: inputStats,
            snapshotId: 'reuse-test-run',
            createdAt: '2026-04-04T00:00:00.000Z',
          },
          tempDbPath
        ),
      SnapshotMismatchError
    )
  })

  it('excludes records with null plugins_count from iterateIndexableRepos', () => {
    const reposWithNullPlugins = [
      ...inputRepos,
      {
        id: 9001,
        owner: 'needs-review-org',
        repo_name: 'needs-review-repo',
        description: 'Repo with null plugins_count needs review',
        plugins_count: null,
      },
    ]

    buildPublicCatalog(
      {
        records: reposWithNullPlugins,
        stats: inputStats,
        snapshotId: 'indexable-filter-test',
      },
      tempDbPath
    )

    const reader = openPublicCatalog(tempDbPath)
    try {
      const indexable = Array.from(reader.iterateIndexableRepos())
      assert.ok(!indexable.some((r) => r.repo_name === 'needs-review-repo'))
    } finally {
      reader.close()
    }
  })

  it('applies description fallback for nullish archived while preserving explicit false', () => {
    const customRepos = [
      {
        id: 9101,
        owner: 'archive-test',
        repo_name: 'implicit-archived',
        description: '  [Archived] legacy plugin repository  ',
        stargazers_count: 50,
        // archived is undefined
      },
      {
        id: 9102,
        owner: 'archive-test',
        repo_name: 'explicit-not-archived',
        description: '[archived] but explicitly false',
        stargazers_count: 10,
        archived: false,
      },
    ]

    buildPublicCatalog(
      {
        records: customRepos,
        stats: [],
        snapshotId: 'archive-fallback-test',
      },
      tempDbPath
    )

    const reader = openPublicCatalog(tempDbPath)
    try {
      const browse = reader.getBrowsePage({ sort: 'stars-desc', pageSize: 10 })
      // Even though explicit-not-archived has only 10 stars and implicit-archived has 50 stars,
      // implicit-archived should sort last because it is archived.
      assert.equal(browse.matches[0].repo_name, 'explicit-not-archived')
      assert.equal(browse.matches[1].repo_name, 'implicit-archived')
    } finally {
      reader.close()
    }
  })

  it('rejects snapshots with markdown path collisions (owner/repo and owner/repo.md)', () => {
    const collidingRepos = [
      {
        id: 9201,
        owner: 'clash-org',
        repo_name: 'collision-target',
        description: 'First path without extension',
      },
      {
        id: 9202,
        owner: 'clash-org',
        repo_name: 'collision-target.md',
        description: 'Colliding path with .md extension',
      },
    ]

    assert.throws(
      () =>
        buildPublicCatalog(
          {
            records: collidingRepos,
            stats: [],
            snapshotId: 'collision-test',
          },
          tempDbPath
        ),
      MarkdownPathCollisionError
    )

    // Reverse order of arrival should also collide
    assert.throws(
      () =>
        buildPublicCatalog(
          {
            records: collidingRepos.slice().reverse(),
            stats: [],
            snapshotId: 'collision-test-reverse',
          },
          tempDbPath
        ),
      MarkdownPathCollisionError
    )
  })

  it('persists provenance metadata in snapshot manifest and reader metadata', () => {
    const provenance = {
      commit: 'abc1234567890abcdef',
      runId: '987654321',
      source: 'crawler-worker-1',
    }

    const manifest = buildPublicCatalog(
      {
        records: inputRepos,
        stats: inputStats,
        snapshotId: 'provenance-test-snapshot',
        provenance,
      },
      tempDbPath
    )

    assert.deepEqual(manifest.provenance, provenance)

    const reader = openPublicCatalog(tempDbPath)
    try {
      const meta = reader.getCatalogMetadata()
      assert.deepEqual(meta.provenance, provenance)
    } finally {
      reader.close()
    }
  })
})
