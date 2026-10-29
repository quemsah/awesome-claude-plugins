/** biome-ignore-all lint/style/useNamingConvention: Fixtures reflect the external catalog schema. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCatalogRecords, diffCatalogRecords, fingerprintCatalog } from './indexnow-changes.mjs'

const site = 'https://awesomeclaudeplugins.com'
const repo = (owner, repoName, pluginsCount = 1, description = 'unchanged') => ({
  owner,
  repo_name: repoName,
  plugins_count: pluginsCount,
  description,
})

test('indexes only the first canonical and indexable record', () => {
  const records = buildCatalogRecords(
    [repo('Team', 'Tool', 2), repo('team', 'tool', 3), repo('Team', 'Missing', null), repo('Team', 'Next', 0)],
    site
  )
  assert.equal(records.size, 2)
  assert.equal(records.get('team/tool').url, `${site}/Team/Tool`)
  assert.equal(records.has('team/missing'), false)
})

test('detects added and updated records without resubmitting unchanged URLs', () => {
  const old = buildCatalogRecords([repo('a', 'same'), repo('a', 'updated', 1, 'old')], site)
  const next = buildCatalogRecords([repo('a', 'same'), repo('a', 'updated', 1, 'new'), repo('b', 'added')], site)
  assert.deepEqual(diffCatalogRecords(old, next), {
    changedUrls: [`${site}/a/updated`, `${site}/b/added`],
    retiredUrls: [],
  })
})

test('submits formerly indexable, deleted and recased URLs as retired', () => {
  const old = buildCatalogRecords([repo('a', 'noindex'), repo('b', 'deleted'), repo('Team', 'Tool')], site)
  const next = buildCatalogRecords([repo('a', 'noindex', null), repo('team', 'tool')], site)
  assert.deepEqual(diffCatalogRecords(old, next), {
    changedUrls: [`${site}/team/tool`],
    retiredUrls: [`${site}/a/noindex`, `${site}/b/deleted`, `${site}/Team/Tool`],
  })
})

test('fingerprints depend on catalog data and not object identity', () => {
  const data = [repo('a', 'same')]
  assert.equal(fingerprintCatalog(data), fingerprintCatalog(JSON.parse(JSON.stringify(data))))
  assert.notEqual(fingerprintCatalog(data), fingerprintCatalog([repo('a', 'same', 4)]))
  assert.deepEqual(diffCatalogRecords(buildCatalogRecords(data, site), buildCatalogRecords(data, site)), {
    changedUrls: [],
    retiredUrls: [],
  })
})
