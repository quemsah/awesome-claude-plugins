import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildPublicCatalog } from '../src/build.js'
import { openPublicCatalog } from '../src/read.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const fixturesDir = join(__dirname, '../../fixtures/catalog-snapshot/v1')
const inputRepos = JSON.parse(readFileSync(join(fixturesDir, 'input-repos.json'), 'utf8'))
const inputStats = JSON.parse(readFileSync(join(fixturesDir, 'input-stats.json'), 'utf8'))

const tempDbPath = join(__dirname, 'test-preserves-published-records.sqlite')

describe('snapshotPreservesPublishedRecords', () => {
  after(() => {
    try {
      rmSync(tempDbPath, { force: true })
    } catch {}
  })

  it('preserves all published records in exact source_order and field fidelity', () => {
    const manifest = buildPublicCatalog(
      {
        records: inputRepos,
        stats: inputStats,
        snapshotId: 'test-run-1',
        createdAt: '2026-11-01T00:00:00.000Z',
      },
      tempDbPath
    )

    assert.equal(manifest.recordCount, inputRepos.length)
    assert.equal(manifest.statsCount, inputStats.length)

    const reader = openPublicCatalog(tempDbPath)
    try {
      const metadata = reader.getCatalogMetadata()
      assert.equal(metadata.record_count, inputRepos.length)
      assert.equal(metadata.stats_count, inputStats.length)

      // Browse should return canonical records
      const browsePage = reader.getBrowsePage({ page: 0, pageSize: 50 })
      assert.ok(browsePage.matches.length > 0)

      // Verify all published records in exact source_order
      const publishedRecords = Array.from(reader.iteratePublishedRecords())
      assert.equal(publishedRecords.length, inputRepos.length)
      assert.deepEqual(publishedRecords, inputRepos)

      // Verify each record by source order
      for (let i = 0; i < inputRepos.length; i++) {
        const record = reader.getRecordBySourceOrder(i)
        assert.deepEqual(record, inputRepos[i])
      }
    } finally {
      reader.close()
    }
  })
})
