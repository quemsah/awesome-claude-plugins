import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildCatalogRecords, fingerprintCatalog } from './indexnow-changes.mjs'
import { serializeBaseline } from './indexnow-state.mjs'

const site = 'https://awesomeclaudeplugins.com'
const catalog = JSON.parse(readFileSync(new URL('../src/data/repos.json', import.meta.url), 'utf8'))
const API_FAILURE_PATTERN = /IndexNow rejected the request: 503/
let importCounter = 0

async function runWithMockedFetch({ baselinePath, fetcher, defer = true }) {
  const previousFetch = globalThis.fetch
  const keys = ['INDEXNOW_MODE', 'INDEXNOW_SITE_URL', 'INDEXNOW_BASELINE_PATH', 'INDEXNOW_DEFER_UNTIL_DEPLOYED']
  const previousEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  try {
    process.env.INDEXNOW_MODE = 'changed'
    process.env.INDEXNOW_SITE_URL = site
    process.env.INDEXNOW_BASELINE_PATH = baselinePath
    process.env.INDEXNOW_DEFER_UNTIL_DEPLOYED = String(defer)
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
  const baselinePath = join(dir, 'repos.json')
  const baseline = '{"version":1,"records":{}}\n'
  writeFileSync(baselinePath, baseline)
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
    assert.equal(readFileSync(baselinePath, 'utf8'), baseline)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('scheduled IndexNow bootstraps from the live sitemap after deployment when baseline is absent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'indexnow-bootstrap-'))
  const baselinePath = join(dir, 'repos.json')
  const first = [...buildCatalogRecords(catalog, site).values()][0]
  assert.ok(first, 'Catalog must have an indexable repository for this integration test')
  const posts = []
  try {
    await runWithMockedFetch({
      baselinePath,
      fetcher: async (url, options) => {
        const endpoint = String(url)
        if (endpoint === `${site}/api/catalog-version`) {
          return { ok: true, json: async () => ({ sha256: fingerprintCatalog(catalog) }) }
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
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
    assert.equal(Object.keys(baseline.records).length, 1)
    assert.equal(Object.values(baseline.records)[0].url, first.url)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('scheduled IndexNow does not publish unchanged URLs or mutate its baseline', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'indexnow-noop-'))
  const baselinePath = join(dir, 'repos.json')
  const baseline = serializeBaseline(buildCatalogRecords(catalog, site))
  writeFileSync(baselinePath, baseline)
  const calls = []
  try {
    await runWithMockedFetch({
      baselinePath,
      fetcher: async (url) => {
        calls.push(String(url))
        assert.equal(String(url), `${site}/api/catalog-version`)
        return { ok: true, json: async () => ({ sha256: fingerprintCatalog(catalog) }) }
      },
    })
    assert.deepEqual(calls, [`${site}/api/catalog-version`])
    assert.equal(readFileSync(baselinePath, 'utf8'), baseline)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('failed IndexNow API submission leaves the previous baseline intact', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'indexnow-failed-post-'))
  const baselinePath = join(dir, 'repos.json')
  const records = buildCatalogRecords(catalog, site)
  const key = records.keys().next().value
  assert.ok(key, 'Catalog must have an indexable repository for this integration test')
  const current = records.get(key)
  records.set(key, { ...current, fingerprint: 'previous-fingerprint' })
  const baseline = serializeBaseline(records)
  writeFileSync(baselinePath, baseline)
  const calls = []
  try {
    await assert.rejects(
      runWithMockedFetch({
        baselinePath,
        fetcher: async (url, options) => {
          const endpoint = String(url)
          calls.push(endpoint)
          if (endpoint === `${site}/api/catalog-version`) {
            return { ok: true, json: async () => ({ sha256: fingerprintCatalog(catalog) }) }
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
    assert.deepEqual(calls, [`${site}/api/catalog-version`, current.url, 'https://api.indexnow.org/indexnow'])
    assert.equal(readFileSync(baselinePath, 'utf8'), baseline)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
