import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { getCanonicalCatalogRepos, searchCatalogRepos } from '../src/lib/catalog.ts'
import { normalizeSearchQuery } from '../src/lib/searchQuery.ts'
import { sortOptionValues } from '../src/lib/sortOptions.ts'

// Run from ui with Node 24: node scripts/benchmark-catalog-search.mjs --url http://127.0.0.1:3001 --out .local/search-proof.json
// No result cache is involved. HTTP requests use separate simulated clients to respect the per-client rate limit.
const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    seconds: { type: 'string', default: '60' },
    rate: { type: 'string', default: '50' },
    out: { type: 'string' },
  },
})
const seconds = Number(values.seconds)
const rate = Number(values.rate)
assert(Number.isInteger(seconds) && seconds >= 3)
assert(Number.isInteger(rate) && rate > 0)

const repos = getCanonicalCatalogRepos()
const queries = [
  'z'.repeat(32),
  'uniqueweatherplugin',
  'superpowers',
  'claude',
  'co',
  'cl',
  'plugin',
  'code',
  'context-mode',
  'claude c',
  'claude a',
  'c?',
]
const core = []
for (const query of queries) {
  for (const sort of sortOptionValues) {
    const start = performance.now()
    const result = searchCatalogRepos(query, sort, 0, 24, { summaries: 'omit' })
    core.push({ query, sort, ms: performance.now() - start, total: result.total })
  }
}
const percentile = (items, quantile) => [...items].sort((a, b) => a - b)[Math.ceil(items.length * quantile) - 1] ?? 0
const summary = (samples) => ({
  count: samples.length,
  p50: percentile(samples, 0.5),
  p95: percentile(samples, 0.95),
  max: Math.max(0, ...samples),
})
const report = { timestamp: new Date().toISOString(), catalogSize: repos.length, core, coreSummary: summary(core.map((row) => row.ms)) }
console.log('Uncached search:', JSON.stringify(report.coreSummary))

if (values.url) {
  const uniqueQueries = [...new Set(repos.map((repo) => normalizeSearchQuery(repo.repo_name ?? '')).filter((query) => query.length >= 2))]
  const requestCount = seconds * rate
  assert(uniqueQueries.length >= requestCount + 10, 'Catalog must provide enough distinct queries')
  const request = async (query, id, sort = 'stars-desc') => {
    const url = new URL('/api/catalog', values.url)
    url.searchParams.set('q', query)
    url.searchParams.set('sort', sort)
    url.searchParams.set('view', 'cards')
    const response = await fetch(url, {
      headers: { 'x-real-ip': `search-benchmark-${id}` },
      signal: AbortSignal.timeout(10_000),
    })
    assert(response.status === 200, `HTTP ${response.status}`)
    const body = await response.json()
    assert(Array.isArray(body.repos))
    return body.total
  }
  await request('superpowers', 'warmup')
  const burstStart = performance.now()
  await Promise.all(uniqueQueries.slice(0, 10).map((query, i) => request(query, `burst-${i}`)))
  report.burst10Ms = performance.now() - burstStart
  const samples = []
  const failures = []
  const pending = []
  let hits = 0
  const start = performance.now()
  for (let i = 0; i < requestCount; i++) {
    const scheduled = start + (i * 1000) / rate
    await delay(Math.max(0, scheduled - performance.now()))
    // Include broad matches as well as distinct real repository names; every call hits FTS5.
    const query = i % 10 === 0 ? queries[3 + ((i / 10) % 5)] : uniqueQueries[i + 10]
    pending.push(
      request(query, i, sortOptionValues[i % sortOptionValues.length])
        .then((total) => {
          samples.push({ scheduledMs: scheduled - start, ms: performance.now() - scheduled })
          if (total > 0) hits++
        })
        .catch((error) => failures.push(String(error)))
    )
  }
  await Promise.all(pending)
  const elapsedMs = performance.now() - start
  const windows = [0, 1, 2].map((part) => ({
    window: part + 1,
    ...summary(samples.filter((s) => Math.floor(s.scheduledMs / ((seconds * 1000) / 3)) === part).map((s) => s.ms)),
  }))
  report.http = {
    targetRps: rate,
    seconds,
    completed: samples.length,
    errors: failures,
    hits,
    actualRps: (samples.length * 1000) / elapsedMs,
    ...summary(samples.map((sample) => sample.ms)),
    windows,
  }
  console.log('HTTP load:', JSON.stringify(report.http))
}
if (values.out) writeFileSync(values.out, `${JSON.stringify(report, null, 2)}\n`)
assert(report.coreSummary.max < 50, 'Uncached search exceeded 50 ms')
if (report.http) {
  assert(report.http.errors.length === 0, 'HTTP requests failed')
  assert(report.http.actualRps >= rate * 0.98, 'Requests are queuing')
  assert(report.http.windows[2].p95 <= Math.max(50, report.http.windows[0].p95 * 1.5), 'Latency grows under sustained load')
}
