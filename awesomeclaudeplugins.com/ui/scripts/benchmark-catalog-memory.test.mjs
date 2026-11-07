import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const script = fileURLToPath(new URL('./benchmark-catalog-memory.mjs', import.meta.url))

function compare(baselineImport, candidateImport, baselineWarm = 100, candidateWarm = 100, baselinePeak = 100, candidatePeak = 100, extraArgs = []) {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-memory-gate-'))
  const report = (afterImport, afterQueries, peakRssMiB) => ({
    catalogSize: 1,
    phases: {
      beforeImport: { rssMiB: 50 },
      afterImport: { rssMiB: afterImport },
      afterFirstSearch: { rssMiB: afterQueries },
      afterQueries: { rssMiB: afterQueries, peakRssMiB },
    },
  })
  const basePath = join(dir, 'baseline.json')
  const candidatePath = join(dir, 'candidate.json')
  writeFileSync(basePath, JSON.stringify(report(baselineImport, baselineWarm, baselinePeak)))
  writeFileSync(candidatePath, JSON.stringify(report(candidateImport, candidateWarm, candidatePeak)))
  const result = spawnSync(process.execPath, [script, '--baseline', basePath, '--candidate', candidatePath, ...extraArgs], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_STEP_SUMMARY: '' },
  })
  rmSync(dir, { recursive: true, force: true })
  return result
}

test('regular comparisons accept an import increase within the 10% regression budget', () => {
  const result = compare(100, 105, 100, 105, 100, 110)
  assert.equal(result.status, 0, result.stderr)
})

test('regular comparisons reject RSS growth above 10%', () => {
  const result = compare(100, 100, 100, 111)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Warm search RSS regression exceeds 10%/)
})

test('regular comparisons also cap initialization and peak RSS growth at 10%', () => {
  const importResult = compare(100, 111)
  assert.notEqual(importResult.status, 0)
  assert.match(importResult.stderr, /Catalog initialization RSS regression exceeds 10%/)

  const peakResult = compare(100, 100, 100, 100, 100, 111)
  assert.notEqual(peakResult.status, 0)
  assert.match(peakResult.stderr, /Peak RSS regression exceeds 10%/)
})

test('migration comparisons still require at least 10% lower import RSS', () => {
  const result = compare(100, 95, 100, 100, 100, 100, ['--require-import-improvement'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Migration must reduce catalog initialization RSS at least 10%/)
})
