import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildPublicCatalog } from '../src/build.js'
import {
  CorruptedSnapshotError,
  IncompatibleSchemaError,
  InvalidSnapshotInputError,
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
})
