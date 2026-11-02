import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { prepareCatalog } from '../../scripts/prepare-catalog.mjs'

const MISSING_STATS_PATTERN = /Catalog statistics dataset not found/

describe('prepareCatalog script', () => {
  const tempDir = join(process.cwd(), 'src/lib/__temp_test_prepare_catalog__')

  beforeEach(() => {
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('fails if stats.json is missing rather than generating incomplete snapshot', () => {
    writeFileSync(join(tempDir, 'repos.json'), JSON.stringify([]))
    // stats.json is deliberately omitted

    expect(() => prepareCatalog({ dataDir: tempDir })).toThrow(MISSING_STATS_PATTERN)
  })
  const writeSample = () => {
    writeFileSync(join(tempDir, 'repos.json'), JSON.stringify([
      { id: 1, owner: 'example', repo_name: 'plugin', description: 'A searchable plugin', plugins_count: 1, stargazers_count: 5 }
    ]))
    writeFileSync(join(tempDir, 'stats.json'), JSON.stringify([
      { id: 1, date: '2026-11-01', size: 1 }
    ]))
  }

  it('changes the snapshot identity when statistics change', () => {
    writeSample()
    const first = prepareCatalog({ dataDir: tempDir })
    writeFileSync(join(tempDir, 'stats.json'), JSON.stringify([
      { id: 1, date: '2026-11-01', size: 1 },
      { id: 2, date: '2026-11-02', size: 1 }
    ]))
    const second = prepareCatalog({ dataDir: tempDir })
    expect(second.snapshotId).not.toBe(first.snapshotId)
  })

  it('refuses a modified artifact when the external manifest SHA-256 disagrees', () => {
    writeSample()
    const first = prepareCatalog({ dataDir: tempDir })
    const db = new Database(join(tempDir, 'catalog.sqlite'))
    try {
      db.prepare('UPDATE repo_fts SET text = ? WHERE rowid = 1').run('different FTS text')
    } finally {
      db.close()
    }
    const manifest = JSON.parse(readFileSync(join(tempDir, 'catalog.manifest.json'), 'utf8'))
    expect(manifest.artifactSha256).toBe(first.artifactSha256)
    expect(() => prepareCatalog({ dataDir: tempDir })).toThrow(/published SHA-256/)
  })

})
