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

const tempDbPath = join(__dirname, 'test-manifest-kinds-summaries.sqlite')

describe('manifestKindsAndSummaries', () => {
  after(() => {
    try {
      rmSync(tempDbPath, { force: true })
    } catch {}
  })

  it('distinguishes standalone-plugin from marketplace and indexes plugins beyond the 30th item', () => {
    buildPublicCatalog(
      {
        records: inputRepos,
        stats: inputStats,
        snapshotId: 'test-run-manifests',
      },
      tempDbPath
    )

    const reader = openPublicCatalog(tempDbPath)
    try {
      // 1. Check standalone-plugin record
      const standalone = reader.getRepoByPath('standalone-author/standalone-tool')
      assert.ok(standalone)
      assert.equal(standalone.manifest_kind, 'standalone-plugin')
      assert.equal(standalone.plugin_name, 'standalone-tool')
      assert.equal(standalone.plugin_description, 'Single-plugin manifest repository description.')

      // 2. Check marketplace record
      const marketplace = reader.getRepoByPath('standard-org/standard-plugin')
      assert.ok(marketplace)
      assert.equal(marketplace.manifest_kind, 'marketplace')

      // 3. Search query finding plugin-31-special-needle beyond 30 items
      const searchResult = reader.searchRepos('special needle beyond thirty limit')
      assert.ok(searchResult.matches.length > 0, 'FTS search must find plugin term beyond 30 items')
      const matched = searchResult.matches.find(
        (m) => m.item.owner === 'many-plugins-org' && m.item.repo_name === 'mega-marketplace'
      )
      assert.ok(matched, 'mega-marketplace must match query for the 31st plugin')
    } finally {
      reader.close()
    }
  })
})
