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

const tempDbPath = join(__dirname, 'test-timestamps-optional-fields.sqlite')

describe('timestampsAndOptionalFields', () => {
  after(() => {
    try {
      rmSync(tempDbPath, { force: true })
    } catch {}
  })

  it('preserves optional fields without coercing undefined to false/0/empty or null to undefined', () => {
    buildPublicCatalog(
      {
        records: inputRepos,
        stats: inputStats,
        snapshotId: 'test-run-optional-fields',
      },
      tempDbPath
    )

    const reader = openPublicCatalog(tempDbPath)
    try {
      // 1. doc-org/awesome-guide.md has license: null explicitly
      const guide = reader.getRepoByPath('doc-org/awesome-guide.md')
      assert.ok(guide)
      assert.strictEqual(guide.license, null, 'license: null must remain null, not undefined')
      assert.strictEqual(guide.archived, false, 'archived: false must remain boolean false')

      // 2. reused-id-org/reused-id-repo has omitted license (undefined), archived: true, omitted plugins
      const reused = reader.getRepoByPath('reused-id-org/reused-id-repo')
      assert.ok(reused)
      assert.strictEqual(reused.license, undefined, 'omitted license must remain undefined')
      assert.strictEqual(reused.archived, true, 'archived: true must remain boolean true')
      assert.strictEqual(reused.plugins, undefined, 'omitted plugins must remain undefined, not empty array')
      assert.strictEqual(reused.pushed_at, undefined, 'omitted pushed_at must remain undefined')
      assert.strictEqual(reused.catalog_added_at, undefined, 'omitted catalog_added_at must remain undefined')

      // 3. standard-plugin has license: 'MIT' and archived: false
      const standard = reader.getRepoByPath('standard-org/standard-plugin')
      assert.ok(standard)
      assert.strictEqual(standard.license, 'MIT')
      assert.strictEqual(standard.archived, false)
      assert.strictEqual(standard.pushed_at, '2026-10-30T10:00:00.000Z')
    } finally {
      reader.close()
    }
  })
})
