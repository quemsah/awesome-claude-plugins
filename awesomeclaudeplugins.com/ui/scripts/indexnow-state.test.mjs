import assert from 'node:assert/strict'
import test from 'node:test'
import { deserializeBaseline, sendIndexNowBatch, serializeBaseline } from './indexnow-state.mjs'

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
