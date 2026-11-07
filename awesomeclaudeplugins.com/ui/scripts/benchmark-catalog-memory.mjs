import assert from 'node:assert/strict'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

// Run in either revision's ui directory with Node 24; source may be outside that revision.
const { values } = parseArgs({
  options: {
    label: { type: 'string' },
    out: { type: 'string' },
    baseline: { type: 'string' },
    candidate: { type: 'string' },
    'require-import-improvement': { type: 'boolean', default: false },
  },
})
const mib = 1024 * 1024
const round = (n) => Math.round(n * 100) / 100
const median = (a) => {
  const b = [...a].sort((x, y) => x - y)
  return b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2
}
const snapshotValue = (stage) => (r) => r.phases[stage].rssMiB
const stageDelta = (end, start) => (r) => r.phases[end].rssMiB - r.phases[start].rssMiB

if (values.baseline || values.candidate) {
  assert(values.baseline && values.candidate, 'Both --baseline and --candidate are required')
  const load = (arg) => arg.split(',').map((path) => JSON.parse(readFileSync(path.trim(), 'utf8')))
  const base = load(values.baseline),
    pr = load(values.candidate)
  const sizes = [...base, ...pr].map((run) => run.catalogSize)
  assert(
    sizes.every((size) => size === sizes[0]),
    'Catalog sizes differ'
  )
  const rows = [
    ['Before import (RSS)', snapshotValue('beforeImport')],
    ['After import (RSS)', snapshotValue('afterImport')],
    ['After first query (RSS)', snapshotValue('afterFirstSearch')],
    ['After six distinct queries (RSS)', snapshotValue('afterQueries')],
    ['Catalog import RSS delta', stageDelta('afterImport', 'beforeImport')],
    ['First query RSS delta', stageDelta('afterFirstSearch', 'afterImport')],
    ['Six queries RSS delta', stageDelta('afterQueries', 'afterFirstSearch')],
    ['Peak process RSS', (r) => r.phases.afterQueries.peakRssMiB],
  ]
  const md = [
    '## Catalog search memory A/B (MiB, median of independent processes)',
    '',
    `Catalog records: ${sizes[0]}; runs per revision: main=${base.length}, PR=${pr.length}`,
    '',
    '| Measurement | main / FTS5 | PR / FTS5 | PR - main |',
    '| --- | ---: | ---: | ---: |',
  ]
  for (const [name, metric] of rows) {
    const a = median(base.map(metric)),
      b = median(pr.map(metric))
    md.push(`| ${name} | ${a.toFixed(1)} | ${b.toFixed(1)} | ${b >= a ? '+' : ''}${(b - a).toFixed(1)} |`)
  }
  md.push(
    '',
    'Run with Node 24 and --expose-gc on the same runner, with GC before every snapshot.',
    'The import delta includes catalog initialization, not just the search index.',
    'Both versions use lazy FTS5; this PR changes the resident catalog representation and first-search text loading.',
    'The six queries are distinct; these are standalone-module figures, not Next.js RSS or Railway billing.',
    ''
  )
  const output = md.join('\n')
  process.stdout.write(`${output}\n`)
  // Regular changes may not regress any measured RSS by more than 10%. The
  // dedicated migration A/B can additionally require the original import win.
  const baselineImport = median(base.map(snapshotValue('afterImport')))
  const candidateImport = median(pr.map(snapshotValue('afterImport')))
  const baselineWarm = median(base.map(snapshotValue('afterQueries')))
  const candidateWarm = median(pr.map(snapshotValue('afterQueries')))
  const baselinePeak = median(base.map((run) => run.phases.afterQueries.peakRssMiB))
  const candidatePeak = median(pr.map((run) => run.phases.afterQueries.peakRssMiB))
  assert(candidateImport <= baselineImport * 1.1, 'Catalog initialization RSS regression exceeds 10%')
  assert(candidateWarm <= baselineWarm * 1.1, 'Warm search RSS regression exceeds 10%')
  assert(candidatePeak <= baselinePeak * 1.1, 'Peak RSS regression exceeds 10%')
  if (values['require-import-improvement']) {
    assert(candidateImport <= baselineImport * 0.9, 'Migration must reduce catalog initialization RSS at least 10%')
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${output}\n`)
} else {
  assert(global.gc, 'Run with node --expose-gc')
  assert(values.label && values.out, 'Provide --label and --out')
  const collect = () => {
    global.gc()
    global.gc()
    const m = process.memoryUsage()
    const peak = process.resourceUsage().maxRSS
    return {
      rssMiB: round(m.rss / mib),
      heapUsedMiB: round(m.heapUsed / mib),
      heapTotalMiB: round(m.heapTotal / mib),
      externalMiB: round(m.external / mib),
      arrayBuffersMiB: round(m.arrayBuffers / mib),
      // Linux reports peak resident set in KiB; macOS reports it in bytes.
      peakRssMiB: round(peak / (process.platform === 'darwin' ? mib : 1024)),
    }
  }
  const phases = { beforeImport: collect() }
  const catalog = await import(pathToFileURL(resolve(process.cwd(), 'src/lib/catalog.ts')).href)
  const catalogSize =
    typeof catalog.getCatalogCanonicalCount === 'function' ? catalog.getCatalogCanonicalCount() : catalog.getCanonicalCatalogRepos().length
  phases.afterImport = collect()
  const search = (q, sort) => catalog.searchCatalogRepos(q, sort, 0, 24, { summaries: 'omit' })
  const firstResultTotal = search('superpowers', 'stars-desc').total
  assert(firstResultTotal > 0, 'Known-hit search returned no results; refusing to compare memory')
  phases.afterFirstSearch = collect()
  const workload = [
    ['claude', 'stars-desc'],
    ['code', 'forks-desc'],
    ['context-mode', 'updated-desc'],
    ['plugin', 'plugins-desc'],
    ['zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', 'created-desc'],
    ['agents', 'stars-desc'],
  ]
  const queries = workload.map(([query, sort]) => ({ query, sort, total: search(query, sort).total }))
  phases.afterQueries = collect()
  const report = {
    label: values.label,
    date: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    catalogSize,
    firstResultTotal,
    queries,
    phases,
  }
  writeFileSync(values.out, `${JSON.stringify(report, null, 2)}\n`)
  console.log(
    values.label +
      ': catalog=' +
      catalogSize +
      ', RSS=' +
      Object.entries(phases)
        .map(([k, v]) => `${k}=${v.rssMiB}MiB`)
        .join(', ') +
      ', peak=' +
      phases.afterQueries.peakRssMiB +
      'MiB'
  )
}
