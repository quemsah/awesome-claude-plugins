import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { deserializeBaseline, loadBaseline, saveBaseline, sendIndexNowBatch, serializeBaseline } from './indexnow-state.mjs'

const url = 'https://awesomeclaudeplugins.com/org/repo'
const INVALID_BASELINE_PATTERN = /Invalid IndexNow baseline/
const INVALID_RECORD_PATTERN = /Invalid IndexNow baseline record/
const API_FAILURE_PATTERN = /IndexNow rejected the request: 503 Service Unavailable - retry later/

test('baseline roundtrips and filters to URLs confirmed in live sitemap', () => {
  const records = new Map([
    ['org/repo', { fingerprint: 'a1', url }],
    ['org/other', { fingerprint: 'a2', url: 'https://awesomeclaudeplugins.com/org/other' }],
  ])
  const json = serializeBaseline(records, new Set([url]))
  assert.deepEqual([...deserializeBaseline(json)], [['org/repo', { fingerprint: 'a1', url }]])
  assert.deepEqual([...deserializeBaseline(serializeBaseline(records))], [...records])
})

test('sqlite baseline roundtrips and filters accurately', () => {
  const dir = mkdtempSync(join(tmpdir(), 'indexnow-state-test-'))
  const dbPath = join(dir, 'indexnow-state.sqlite')
  try {
    const records = new Map([
      ['org/repo', { fingerprint: 'a1', url }],
      ['org/other', { fingerprint: 'a2', url: 'https://awesomeclaudeplugins.com/org/other' }],
    ])
    saveBaseline(dbPath, records, new Set([url]))
    const loaded = loadBaseline(dbPath)
    assert.deepEqual([...loaded], [['org/repo', { fingerprint: 'a1', url }]])

    saveBaseline(dbPath, records)
    const reloaded = loadBaseline(dbPath)
    assert.deepEqual([...reloaded], [...records])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loadBaseline transparently migrates/reads legacy JSON baseline files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'indexnow-legacy-test-'))
  const jsonPath = join(dir, 'repos.json')
  try {
    const records = new Map([['org/repo', { fingerprint: 'f1', url }]])
    writeFileSync(jsonPath, serializeBaseline(records))
    const loaded = loadBaseline(jsonPath)
    assert.deepEqual([...loaded], [...records])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rejects invalid or truncated baseline and cannot silently advance it', () => {
  assert.throws(() => deserializeBaseline('not json'), SyntaxError)
  assert.throws(() => deserializeBaseline('{"version":2,"records":{}}'), INVALID_BASELINE_PATTERN)
  assert.throws(() => deserializeBaseline('{"version":1,"records":{"x":{}}}'), INVALID_RECORD_PATTERN)
})

test('submits an IndexNow batch with the correct site and verification key', async () => {
  const requests = []
  const fetcher = async (endpoint, options) => {
    requests.push({ endpoint, options })
    return { ok: true }
  }
  await sendIndexNowBatch(
    [url],
    {
      siteUrl: 'https://awesomeclaudeplugins.com',
      key: 'test-key',
      keyLocation: 'https://awesomeclaudeplugins.com/key.txt',
    },
    fetcher
  )
  assert.equal(requests.length, 1)
  assert.equal(requests[0].endpoint, 'https://api.indexnow.org/indexnow')
  assert.equal(requests[0].options.method, 'POST')
  assert.ok(requests[0].options.signal instanceof AbortSignal, 'HTTP submissions must be time-bounded')
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    host: 'awesomeclaudeplugins.com',
    key: 'test-key',
    keyLocation: 'https://awesomeclaudeplugins.com/key.txt',
    urlList: [url],
  })
})

test('failed API submissions reject, preventing the caller from persisting a new baseline', async () => {
  await assert.rejects(
    sendIndexNowBatch([url], { siteUrl: 'https://awesomeclaudeplugins.com', key: 'k', keyLocation: url }, async () => ({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => 'retry later',
    })),
    API_FAILURE_PATTERN
  )
})
