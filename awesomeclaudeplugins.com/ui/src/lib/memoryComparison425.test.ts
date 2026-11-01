import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('temporary memory comparison for PR 425', () => {
  it('compares warmed Node RSS for Fuse and FTS5 on the same catalog', () => {
    const temp = mkdtempSync(join(tmpdir(), 'pr425-memory-'))
    const run = (cmd: string, args: string[], cwd: string, timeout = 120_000) => {
      const result = spawnSync(cmd, args, {
        cwd,
        encoding: 'utf8',
        timeout,
        maxBuffer: 1024 * 1024 * 4,
      })
      if (result.status !== 0) {
        throw new Error(`${cmd} failed: ${result.error ?? ''}\n${result.stdout}\n${result.stderr}`)
      }
      return result.stdout.trim()
    }

    try {
      const oldRepo = join(temp, 'old')
      run(
        'git',
        ['clone', '--depth', '1', '--branch', 'main', '--quiet', 'https://github.com/quemsah/awesome-claude-plugins.git', oldRepo],
        temp
      )
      const baseline = run('git', ['rev-parse', 'HEAD'], oldRepo)
      run('bun', ['install', '--frozen-lockfile'], join(oldRepo, 'awesomeclaudeplugins.com'))

      const probe = join(temp, 'probe.mjs')
      writeFileSync(
        probe,
        `
        import { join } from 'node:path'
        import { pathToFileURL } from 'node:url'
        const cwd = process.argv[2]
        process.chdir(cwd)
        const mb = () => Number((process.memoryUsage().rss / 1048576).toFixed(2))
        const gc = () => { for (let i = 0; i < 3; i++) global.gc?.() }
        gc()
        const beforeImport = mb()
        const loadStart = performance.now()
        const catalog = await import(pathToFileURL(join(cwd, 'src/lib/catalog.ts')).href)
        const loadMs = Number((performance.now() - loadStart).toFixed(2))
        gc()
        const afterImport = mb()
        const queries = ['claude', 'superpowers', 'plugin', 'code', 'context-mode']
        const searchStart = performance.now()
        for (const q of queries) {
          catalog.searchCatalogRepos(q, 'stars-desc', 0, 24, { summaries: 'omit' })
        }
        const searchMs = Number((performance.now() - searchStart).toFixed(2))
        gc()
        const afterSearch = mb()
        console.log('MEMORY_PROBE', JSON.stringify({ beforeImport, afterImport, afterSearch, loadMs, searchMs,
          importedExtra: Number((afterImport-beforeImport).toFixed(2)),
          warmedExtra: Number((afterSearch-beforeImport).toFixed(2)) }))
      `
      )

      const current = process.cwd()
      const old = run('node', ['--expose-gc', probe, join(oldRepo, 'awesomeclaudeplugins.com/ui')], current)
      const next = run('node', ['--expose-gc', probe, current], current)
      const oldMetrics = JSON.parse(old.split('MEMORY_PROBE ')[1] ?? '{}')
      const newMetrics = JSON.parse(next.split('MEMORY_PROBE ')[1] ?? '{}')
      console.log(
        'MEMORY_BENCHMARK_RESULT',
        JSON.stringify({
          baseline,
          candidate: 'fc3a3e904c5f0774a2f27e308666d39cd65b9047',
          old: oldMetrics,
          next: newMetrics,
          warmedDeltaMiB: Number((newMetrics.afterSearch - oldMetrics.afterSearch).toFixed(2)),
        })
      )
      expect(oldMetrics.afterSearch).toBeGreaterThan(0)
      expect(newMetrics.afterSearch).toBeGreaterThan(0)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  }, 180_000)
})
