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

const tempDbPath = join(__dirname, 'test-duplicate-ids-case-paths.sqlite')

describe('duplicateIdsAndCasePaths', () => {
  after(() => {
    try {
      rmSync(tempDbPath, { force: true })
    } catch {}
  })

  it('preserves duplicate source IDs and resolves case-variant paths by first source_order', () => {
    buildPublicCatalog(
      {
        records: inputRepos,
        stats: inputStats,
        snapshotId: 'test-run-duplicates',
      },
      tempDbPath
    )

    const reader = openPublicCatalog(tempDbPath)
    try {
      // 1. Duplicate source ID 1005: both doc-org/awesome-guide.md and reused-id-org/reused-id-repo exist
      const guideRepo = reader.getRepoByPath('doc-org/awesome-guide.md')
      assert.ok(guideRepo)
      assert.equal(guideRepo.id, 1005)
      assert.equal(guideRepo.owner, 'doc-org')

      const reusedIdRepo = reader.getRepoByPath('reused-id-org/reused-id-repo')
      assert.ok(reusedIdRepo)
      assert.equal(reusedIdRepo.id, 1005)
      assert.equal(reusedIdRepo.owner, 'reused-id-org')

      // 2. Case-sensitive path duplicates:
      // First is "Case-Sensitive-Org/Shared-Repo" (id 1003)
      // Second is "case-sensitive-org/shared-repo" (id 1004)
      // Both query variations must resolve to the first canonical record (id 1003)
      const firstLookup = reader.getRepoByPath('Case-Sensitive-Org/Shared-Repo')
      assert.ok(firstLookup)
      assert.equal(firstLookup.id, 1003)
      assert.equal(firstLookup.owner, 'Case-Sensitive-Org')

      const secondLookup = reader.getRepoByPath('case-sensitive-org/shared-repo')
      assert.ok(secondLookup)
      assert.equal(secondLookup.id, 1003)
      assert.equal(secondLookup.owner, 'Case-Sensitive-Org')
    } finally {
      reader.close()
    }
  })
})
