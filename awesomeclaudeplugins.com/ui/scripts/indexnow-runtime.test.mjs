import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildPublicCatalog } from '@awesome-claude-plugins/catalog-snapshot/build'
import fixtureRepos from '../src/test/fixtures/repos.json' with { type: 'json' }
import { buildCatalogRecordsFromSqlite } from './indexnow-changes.mjs'
import { loadBaseline, saveBaseline } from './indexnow-state.mjs'

const site = 'https://awesomeclaudeplugins.com'
const catalogPath = fileURLToPath(new URL('../src/data/catalog.sqlite', import.meta.url))
const { records: catalogRecords, fingerprint: catalogFingerprint } = buildCatalogRecordsFromSqlite(catalogPath, site)
const API_FAILURE_PATTERN = /IndexNow rejected the request: 503/
const BATCH_ABORT_REGEX = /Catalog deployment changed between batch submissions/
let importCounter = 0

async function runWithMockedFetch({ baselinePath, fetcher, defer = true, batchSize, mode = 'changed', resolveDeployed = false }) {
  const previousFetch = globalThis.fetch
  const keys = [
    'INDEXNOW_MODE',
    'INDEXNOW_SITE_URL',
    'INDEXNOW_BASELINE_PATH',
    'INDEXNOW_DEFER_UNTIL_DEPLOYED',
    'INDEXNOW_RESOLVE_DEPLOYED',
    'INDEXNOW_BATCH_SIZE',
  ]
  const previousEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  try {
    process.env.INDEXNOW_MODE = mode
    process.env.INDEXNOW_SITE_URL = site
    process.env.INDEXNOW_BASELINE_PATH = baselinePath
    process.env.INDEXNOW_DEFER_UNTIL_DEPLOYED = String(defer)
    process.env.INDEXNOW_RESOLVE_DEPLOYED = String(resolveDeployed)
    if (batchSize !== undefined) process.env.INDEXNOW_BATCH_SIZE = String(batchSize)
    globalThis.fetch = fetcher
    importCounter += 1
    await import(`./indexnow.mjs?integration-test=${importCounter}`)
  } finally {
    globalThis.fetch = previousFetch
    for (const key of keys) {
      if (previousEnv[key] === undefined) delete process.env[key]
      else process.env[key] = previousEnv[key]
    }
  }
}

test('scheduled IndexNow defers on a stale production catalog without advancing its baseline', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'indexnow-defer-'))
  const baselinePath = join(dir, 'indexnow-state.sqlite')
  saveBaseline(baselinePath, new Map())
  const calls = []
  try {
    await runWithMockedFetch({
      baselinePath,
      fetcher: async (url) => {
        calls.push(String(url))
        assert.equal(String(url), `${site}/api/catalog-version`)
        return { ok: true, json: async () => ({ sha256: 'not-the-current-catalog' }) }
      },
    })
    assert.deepEqual(calls, [`${site}/api/catalog-version`])
    const loaded = loadBaseline(baselinePath)
    assert.equal(loaded.size, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('scheduled IndexNow bootstraps from the live sitemap after deployment when baseline is absent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'indexnow-bootstrap-'))
  const baselinePath = join(dir, 'indexnow-state.sqlite')
  const first = [...catalogRecords.values()][0]
  assert.ok(first, 'Catalog must have an indexable repository for this integration test')
  const posts = []
  try {
    await runWithMockedFetch({
      baselinePath,
      fetcher: async (url, options) => {
        const endpoint = String(url)
        if (endpoint === `${site}/api/catalog-version`) {
          return { ok: true, json: async () => ({ sha256: catalogFingerprint }) }
        }
        if (endpoint === `${site}/sitemap.xml`) {
          return { ok: true, text: async () => `<urlset><url><loc>${first.url}</loc></url></urlset>` }
        }
        if (endpoint === 'https://api.indexnow.org/indexnow') {
          posts.push({ endpoint, options })
          return { ok: true }
        }
        throw new Error(`Unexpected request: ${endpoint}`)
      },
    })
    assert.equal(posts.length, 1)
    assert.deepEqual(JSON.parse(posts[0].options.body).urlList, [first.url])
    assert.ok(existsSync(baselinePath))
    const baseline = loadBaseline(baselinePath)
    assert.equal(baseline.size, 1)
    assert.equal([...baseline.values()][0].url, first.url)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('scheduled IndexNow does not publish unchanged URLs or mutate its baseline', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'indexnow-noop-'))
  const baselinePath = join(dir, 'indexnow-state.sqlite')
  saveBaseline(baselinePath, catalogRecords)
  const calls = []
  try {
    await runWithMockedFetch({
      baselinePath,
      fetcher: async (url) => {
        calls.push(String(url))
        assert.equal(String(url), `${site}/api/catalog-version`)
        return { ok: true, json: async () => ({ sha256: catalogFingerprint }) }
      },
    })
    assert.deepEqual(calls, [`${site}/api/catalog-version`])
    assert.deepEqual([...loadBaseline(baselinePath)], [...catalogRecords])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('failed IndexNow API submission leaves the previous baseline intact', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'indexnow-failed-post-'))
  const baselinePath = join(dir, 'indexnow-state.sqlite')
  const records = new Map(catalogRecords)
  const key = records.keys().next().value
  assert.ok(key, 'Catalog must have an indexable repository for this integration test')
  const current = records.get(key)
  records.set(key, { ...current, fingerprint: 'previous-fingerprint' })
  saveBaseline(baselinePath, records)
  const calls = []
  try {
    await assert.rejects(
      runWithMockedFetch({
        baselinePath,
        fetcher: async (url, options) => {
          const endpoint = String(url)
          calls.push(endpoint)
          if (endpoint === `${site}/api/catalog-version`) {
            return { ok: true, json: async () => ({ sha256: catalogFingerprint }) }
          }
          if (endpoint === current.url && options?.method === 'HEAD') return { status: 200 }
          if (endpoint === 'https://api.indexnow.org/indexnow') {
            return { ok: false, status: 503, statusText: 'Service Unavailable', text: async () => 'retry later' }
          }
          throw new Error(`Unexpected request: ${endpoint}`)
        },
      }),
      API_FAILURE_PATTERN
    )
    assert.deepEqual(calls, [
      `${site}/api/catalog-version`,
      current.url,
      `${site}/api/catalog-version`,
      'https://api.indexnow.org/indexnow',
    ])
    assert.deepEqual([...loadBaseline(baselinePath)], [...records])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('scheduled IndexNow aborts without submitting or mutating baseline if deployment version changes between check 1 and check 2', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'indexnow-version-switch-'))
  const baselinePath = join(dir, 'indexnow-state.sqlite')
  const records = new Map(catalogRecords)
  const [key] = [...records.keys()]
  assert.ok(key, 'Catalog must have an indexable repository for this integration test')
  const current = records.get(key)
  records.set(key, { ...current, fingerprint: 'previous-fingerprint' })
  saveBaseline(baselinePath, records)
  const calls = []
  let versionChecks = 0
  try {
    await runWithMockedFetch({
      baselinePath,
      fetcher: async (url, options) => {
        const endpoint = String(url)
        calls.push(endpoint)
        if (endpoint === `${site}/api/catalog-version`) {
          versionChecks += 1
          if (versionChecks === 1) {
            return { ok: true, json: async () => ({ sha256: catalogFingerprint }) }
          }
          // On second check, deployment changed to a newer version
          return { ok: true, json: async () => ({ sha256: 'newer-in-flight-snapshot' }) }
        }
        if (endpoint === current.url && options?.method === 'HEAD') return { status: 200 }
        if (endpoint === 'https://api.indexnow.org/indexnow') {
          throw new Error('IndexNow API must not be called when deployment version changed')
        }
        throw new Error(`Unexpected request: ${endpoint}`)
      },
    })
    assert.deepEqual(calls, [`${site}/api/catalog-version`, current.url, `${site}/api/catalog-version`])
    // Baseline was not advanced: retains 'previous-fingerprint'
    assert.deepEqual([...loadBaseline(baselinePath)], [...records])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('migrates legacy repos.json from baseline cache directory and detects retired URLs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'indexnow-legacy-migrate-'))
  const baselinePath = join(dir, 'indexnow-state.sqlite')
  const legacyJsonPath = join(dir, 'repos.json')
  const retiredUrl = `${site}/retired-org/retired-plugin`
  const legacyRecords = new Map([...catalogRecords, ['retired-org/retired-plugin', { fingerprint: 'legacy-hash', url: retiredUrl }]])
  const legacyJson = JSON.stringify({
    version: 1,
    records: Object.fromEntries(legacyRecords),
  })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(legacyJsonPath, legacyJson, 'utf8')

  const calls = []
  let submittedUrls = []
  try {
    await runWithMockedFetch({
      baselinePath,
      fetcher: async (url, options) => {
        const endpoint = String(url)
        calls.push(endpoint)
        if (endpoint === `${site}/api/catalog-version`) {
          return { ok: true, json: async () => ({ sha256: catalogFingerprint }) }
        }
        if (endpoint === 'https://api.indexnow.org/indexnow') {
          const body = JSON.parse(options?.body ?? '{}')
          submittedUrls = body.urlList ?? []
          return { ok: true }
        }
        throw new Error(`Unexpected request: ${endpoint}`)
      },
    })
    // Baseline should have been migrated to SQLite
    assert.ok(existsSync(baselinePath), 'indexnow-state.sqlite should be created from legacy cache')
    // Retired URL was submitted to IndexNow
    assert.ok(submittedUrls.includes(retiredUrl), 'Retired URL should be submitted to IndexNow')
    // New baseline should now match current catalog (retired URL removed)
    const reloaded = loadBaseline(baselinePath)
    assert.equal(reloaded.has('retired-org/retired-plugin'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('scheduled IndexNow re-checks fingerprint between batches and aborts without saving baseline if production version changed during submission', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'indexnow-batch-version-switch-'))
  const baselinePath = join(dir, 'indexnow-state.sqlite')
  const records = new Map(catalogRecords)
  const keys = [...records.keys()]
  assert.ok(keys.length >= 2, 'Catalog must have at least 2 repositories for multi-batch test')
  const [key1, key2] = keys.slice(0, 2)
  const rec1 = records.get(key1)
  const rec2 = records.get(key2)
  records.set(key1, { ...rec1, fingerprint: 'previous-fingerprint-1' })
  records.set(key2, { ...rec2, fingerprint: 'previous-fingerprint-2' })
  saveBaseline(baselinePath, records)

  const calls = []
  let versionChecks = 0
  let indexNowSubmissions = 0
  try {
    await assert.rejects(
      runWithMockedFetch({
        baselinePath,
        batchSize: 1,
        fetcher: async (url, options) => {
          const endpoint = String(url)
          calls.push(endpoint)
          if (endpoint === `${site}/api/catalog-version`) {
            versionChecks += 1
            // Check 1 (initial), check 2 (after readiness check) succeed with current fingerprint
            if (versionChecks <= 2) {
              return { ok: true, json: async () => ({ sha256: catalogFingerprint }) }
            }
            // Check 3 (between batch 1 and batch 2) sees deployment changed!
            return { ok: true, json: async () => ({ sha256: 'deployed-version-changed-mid-flight' }) }
          }
          if ((endpoint === rec1.url || endpoint === rec2.url) && options?.method === 'HEAD') {
            return { status: 200 }
          }
          if (endpoint === 'https://api.indexnow.org/indexnow') {
            indexNowSubmissions += 1
            return { ok: true }
          }
          throw new Error(`Unexpected request: ${endpoint}`)
        },
      }),
      BATCH_ABORT_REGEX
    )
    // Only 1 batch of 1 URL was submitted; the 2nd batch was aborted
    assert.equal(indexNowSubmissions, 1)
    // Baseline was NOT advanced: still holds previous fingerprints
    const loaded = loadBaseline(baselinePath)
    assert.equal(loaded.get(key1).fingerprint, 'previous-fingerprint-1')
    assert.equal(loaded.get(key2).fingerprint, 'previous-fingerprint-2')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('scheduled IndexNow re-checks fingerprint before saving baseline and aborts without advancing baseline if production version changed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'indexnow-final-check-version-switch-'))
  const baselinePath = join(dir, 'indexnow-state.sqlite')
  const records = new Map(catalogRecords)
  const [key] = [...records.keys()]
  assert.ok(key, 'Catalog must have an indexable repository for this integration test')
  const current = records.get(key)
  records.set(key, { ...current, fingerprint: 'previous-fingerprint' })
  saveBaseline(baselinePath, records)

  const calls = []
  let versionChecks = 0
  let indexNowSubmissions = 0
  try {
    await runWithMockedFetch({
      baselinePath,
      fetcher: async (url, options) => {
        const endpoint = String(url)
        calls.push(endpoint)
        if (endpoint === `${site}/api/catalog-version`) {
          versionChecks += 1
          // Check 1 (initial) and Check 2 (pre-submit) succeed
          if (versionChecks <= 2) {
            return { ok: true, json: async () => ({ sha256: catalogFingerprint }) }
          }
          // Final check before baseline save sees version changed!
          return { ok: true, json: async () => ({ sha256: 'version-rolled-back-or-advanced' }) }
        }
        if (endpoint === current.url && options?.method === 'HEAD') return { status: 200 }
        if (endpoint === 'https://api.indexnow.org/indexnow') {
          indexNowSubmissions += 1
          return { ok: true }
        }
        throw new Error(`Unexpected request: ${endpoint}`)
      },
    })
    // URL was submitted, but baseline update was aborted on final check
    assert.equal(indexNowSubmissions, 1)
    const loaded = loadBaseline(baselinePath)
    assert.equal(loaded.get(key).fingerprint, 'previous-fingerprint')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('IndexNow full mode establishes baseline and submits URLs when mock site and indexnow endpoints are provided', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'indexnow-resolve-deployed-'))
  const baselinePath = join(dir, 'indexnow-state.sqlite')
  saveBaseline(baselinePath, new Map())

  let submittedUrls = []
  try {
    await runWithMockedFetch({
      baselinePath,
      mode: 'full',
      fetcher: async (url, options) => {
        const endpoint = String(url)
        if (endpoint === `${site}/api/catalog-version`) {
          return {
            ok: true,
            json: async () => ({
              sha256: catalogFingerprint,
              snapshotId: 'active-production-snapshot',
            }),
          }
        }
        if (endpoint === `${site}/sitemap.xml`) {
          const firstUrl = [...catalogRecords.values()][0].url
          return {
            ok: true,
            text: async () => `<urlset><loc>${firstUrl}</loc></urlset>`,
          }
        }
        if (endpoint.startsWith('file://')) {
          const { readFileSync } = await import('node:fs')
          const { fileURLToPath } = await import('node:url')
          const buf = readFileSync(fileURLToPath(endpoint))
          return {
            ok: true,
            arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
          }
        }
        if (endpoint === 'https://api.indexnow.org/indexnow') {
          const body = JSON.parse(options?.body ?? '{}')
          submittedUrls = body.urlList ?? []
          return { ok: true }
        }
        throw new Error(`Unexpected request: ${endpoint}`)
      },
    })
    // Baseline was established from active release
    const loaded = loadBaseline(baselinePath)
    assert.ok(loaded.size > 0, 'Baseline should be established from resolved deployed release')
    assert.ok(submittedUrls.length > 0, 'Submitted URLs should be recorded')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('IndexNow resolves and submits the deployed SQLite snapshot when production rolled back', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'indexnow-resolve-rollback-'))
  const baselinePath = join(dir, 'indexnow-state.sqlite')
  const deployedCatalogPath = join(dir, 'deployed-catalog.sqlite')
  saveBaseline(baselinePath, new Map())
  const deployedSnapshotId = 'rollback-snapshot'
  buildPublicCatalog(
    {
      records: fixtureRepos,
      stats: [{ id: 1, date: '2026-11-01T00:00:00.000Z', size: fixtureRepos.length }],
      snapshotId: deployedSnapshotId,
    },
    deployedCatalogPath
  )
  const deployedCatalog = buildCatalogRecordsFromSqlite(deployedCatalogPath, site)
  const firstUrl = [...deployedCatalog.records.values()][0]?.url
  assert.ok(firstUrl, 'Deployed fixture must have an indexable repository')
  const artifactUrl = `https://github.com/quemsah/awesome-claude-plugins/releases/download/catalog-${deployedSnapshotId}/catalog.sqlite`
  const releaseUrl = `https://api.github.com/repos/quemsah/awesome-claude-plugins/releases/tags/catalog-${deployedSnapshotId}`
  const artifactBytes = readFileSync(deployedCatalogPath)
  const artifactDigest = createHash('sha256').update(artifactBytes).digest('hex')
  const submitted = []

  try {
    await runWithMockedFetch({
      baselinePath,
      mode: 'full',
      resolveDeployed: true,
      fetcher: async (url, options) => {
        const endpoint = String(url)
        if (endpoint === `${site}/api/catalog-version`) {
          return {
            ok: true,
            json: async () => ({ sha256: deployedCatalog.fingerprint, snapshotId: deployedSnapshotId }),
          }
        }
        if (endpoint === releaseUrl) {
          return {
            ok: true,
            json: async () => ({
              // biome-ignore lint/style/useNamingConvention: GitHub release API uses snake_case keys
              tag_name: `catalog-${deployedSnapshotId}`,
              assets: [
                {
                  name: 'catalog.sqlite',
                  state: 'uploaded',
                  // biome-ignore lint/style/useNamingConvention: GitHub release API uses snake_case keys
                  browser_download_url: artifactUrl,
                  size: artifactBytes.byteLength,
                  digest: `sha256:${artifactDigest}`,
                },
              ],
            }),
          }
        }
        if (endpoint === artifactUrl) {
          return new Response(artifactBytes)
        }
        if (endpoint === `${site}/sitemap.xml`) {
          return { ok: true, text: async () => `<urlset><loc>${firstUrl}</loc></urlset>` }
        }
        if (endpoint === 'https://api.indexnow.org/indexnow') {
          submitted.push(...JSON.parse(options?.body ?? '{}').urlList)
          return { ok: true }
        }
        throw new Error(`Unexpected request: ${endpoint}`)
      },
    })
    assert.deepEqual(submitted, [firstUrl])
    const baseline = loadBaseline(baselinePath)
    const [key, record] = [...deployedCatalog.records].find(([, value]) => value.url === firstUrl)
    assert.equal(baseline.size, 1)
    assert.deepEqual(baseline.get(key), record)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('scheduled IndexNow keeps its baseline on invalid rollback release artifacts or a changing deployment', async () => {
  for (const scenario of [
    'digest-mismatch',
    'missing-digest',
    'snapshot-mismatch',
    'deployment-changed',
    'oversized-release',
    'stream-overflow',
    'truncated-stream',
    'missing-body',
  ]) {
    const dir = mkdtempSync(join(tmpdir(), `indexnow-integrity-${scenario}-`))
    const baselinePath = join(dir, 'baseline.sqlite')
    const snapshotPath = join(dir, 'snapshot.sqlite')
    const deployedSnapshotId = 'expected-rollback'
    const actualSnapshotId = scenario === 'snapshot-mismatch' ? 'unexpected-rollback' : deployedSnapshotId
    buildPublicCatalog(
      {
        records: fixtureRepos,
        stats: [{ id: 1, date: '2026-11-01T00:00:00.000Z', size: fixtureRepos.length }],
        snapshotId: actualSnapshotId,
      },
      snapshotPath
    )
    const catalog = buildCatalogRecordsFromSqlite(snapshotPath, site)
    const artifactBytes = readFileSync(snapshotPath)
    const digest = createHash('sha256').update(artifactBytes).digest('hex')
    const tag = `catalog-${deployedSnapshotId}`
    const releaseUrl = `https://api.github.com/repos/quemsah/awesome-claude-plugins/releases/tags/${tag}`
    const artifactUrl = `https://github.com/quemsah/awesome-claude-plugins/releases/download/${tag}/catalog.sqlite`
    const submitted = []
    let versionChecks = 0
    let downloadRequests = 0
    saveBaseline(baselinePath, new Map([['retained/repo', { url: `${site}/retained/repo`, fingerprint: 'baseline' }]]))

    try {
      await runWithMockedFetch({
        baselinePath,
        mode: 'full',
        defer: true,
        resolveDeployed: true,
        fetcher: async (url) => {
          const endpoint = String(url)
          if (endpoint === `${site}/api/catalog-version`) {
            versionChecks++
            return {
              ok: true,
              json: async () => ({
                sha256: scenario === 'deployment-changed' && versionChecks > 1 ? '0'.repeat(64) : catalog.fingerprint,
                snapshotId: deployedSnapshotId,
              }),
            }
          }
          if (endpoint === releaseUrl) {
            return {
              ok: true,
              json: async () => ({
                // biome-ignore lint/style/useNamingConvention: GitHub release API uses snake_case keys
                tag_name: tag,
                assets: [
                  {
                    name: 'catalog.sqlite',
                    state: 'uploaded',
                    // biome-ignore lint/style/useNamingConvention: GitHub release API uses snake_case keys
                    browser_download_url: artifactUrl,
                    size: scenario === 'oversized-release' ? 512 * 1024 * 1024 + 1 : artifactBytes.byteLength,
                    digest: scenario === 'missing-digest' ? null : `sha256:${scenario === 'digest-mismatch' ? '0'.repeat(64) : digest}`,
                  },
                ],
              }),
            }
          }
          if (endpoint === artifactUrl) {
            downloadRequests++
            if (scenario === 'missing-body') return { ok: true, body: null }
            if (scenario === 'stream-overflow') return new Response(Buffer.concat([artifactBytes, Buffer.from('extra')]))
            if (scenario === 'truncated-stream') return new Response(artifactBytes.subarray(0, -1))
            return new Response(artifactBytes)
          }
          if (endpoint === 'https://api.indexnow.org/indexnow') {
            submitted.push(endpoint)
            return { ok: true }
          }
          throw new Error(`Unexpected request: ${endpoint}`)
        },
      })
      assert.deepEqual(submitted, [], `No IndexNow submission expected for ${scenario}`)
      if (scenario === 'oversized-release' || scenario === 'missing-digest') assert.equal(downloadRequests, 0)
      assert.deepEqual([...loadBaseline(baselinePath)], [['retained/repo', { url: `${site}/retained/repo`, fingerprint: 'baseline' }]])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})
