/** biome-ignore-all lint/style/useNamingConvention: JSON fixture preserves published field names */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prepareCatalog } from '../../scripts/prepare-catalog.mjs'

const MISSING_STATS_PATTERN = /Catalog statistics dataset not found/
const ARTIFACT_MISMATCH_PATTERN = /published SHA-256/

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

  it('fails if stats.json is missing rather than generating incomplete snapshot', async () => {
    writeFileSync(join(tempDir, 'repos.json'), JSON.stringify([]))
    // stats.json is deliberately omitted

    await expect(prepareCatalog({ dataDir: tempDir })).rejects.toThrow(MISSING_STATS_PATTERN)
  })
  const writeSample = () => {
    writeFileSync(
      join(tempDir, 'repos.json'),
      JSON.stringify([
        { id: 1, owner: 'example', repo_name: 'plugin', description: 'A searchable plugin', plugins_count: 1, stargazers_count: 5 },
      ])
    )
    writeFileSync(join(tempDir, 'stats.json'), JSON.stringify([{ id: 1, date: '2026-11-01', size: 1 }]))
  }

  it('changes the snapshot identity when statistics change', async () => {
    writeSample()
    const first = await prepareCatalog({ dataDir: tempDir })
    writeFileSync(
      join(tempDir, 'stats.json'),
      JSON.stringify([
        { id: 1, date: '2026-11-01', size: 1 },
        { id: 2, date: '2026-11-02', size: 1 },
      ])
    )
    const second = await prepareCatalog({ dataDir: tempDir })
    expect(second.snapshotId).not.toBe(first.snapshotId)
  })

  it('refuses a modified artifact when the external manifest SHA-256 disagrees', async () => {
    writeSample()
    const first = await prepareCatalog({ dataDir: tempDir })
    const db = new Database(join(tempDir, 'catalog.sqlite'))
    try {
      db.prepare('UPDATE repo_fts SET text = ? WHERE rowid = 1').run('different FTS text')
    } finally {
      db.close()
    }
    const manifest = JSON.parse(readFileSync(join(tempDir, 'catalog.manifest.json'), 'utf8'))
    expect(manifest.artifactSha256).toBe(first.artifactSha256)
    await expect(prepareCatalog({ dataDir: tempDir })).rejects.toThrow(ARTIFACT_MISMATCH_PATTERN)
  })

  it('validates existing sqlite against release pointer', async () => {
    writeSample()
    const first = await prepareCatalog({ dataDir: tempDir })
    const pointer = {
      schemaVersion: first.schemaVersion,
      generatorVersion: first.generatorVersion,
      snapshotId: first.snapshotId,
      catalogFingerprint: first.catalogFingerprint,
      artifactSha256: first.artifactSha256,
      recordCount: first.recordCount,
      canonicalCount: first.canonicalCount,
      pluginsCount: first.pluginsCount,
      statsCount: first.statsCount,
    }
    writeFileSync(join(tempDir, 'catalog-release.json'), JSON.stringify(pointer))
    // Remove repos.json so it only has catalog.sqlite and catalog-release.json
    rmSync(join(tempDir, 'repos.json'))
    rmSync(join(tempDir, 'stats.json'))

    const validated = await prepareCatalog({ dataDir: tempDir })
    expect(validated.artifactSha256).toBe(first.artifactSha256)
  })

  it('refreshes stale sqlite and manifest when pointer advances to a newer release', async () => {
    writeSample()
    await prepareCatalog({ dataDir: tempDir })

    const secondDir = join(tempDir, 'sub')
    mkdirSync(secondDir, { recursive: true })
    const secondRecord = {
      id: 2,
      owner: 'example',
      repo_name: 'second-plugin',
      description: 'Another plugin',
      plugins_count: 1,
      stargazers_count: 10,
    }
    writeFileSync(join(secondDir, 'repos.json'), JSON.stringify([secondRecord]))
    writeFileSync(join(secondDir, 'stats.json'), JSON.stringify([{ id: 1, date: '2026-03-01', size: 1 }]))
    const second = await prepareCatalog({ dataDir: secondDir })

    const pointer = {
      schemaVersion: second.schemaVersion,
      generatorVersion: second.generatorVersion,
      snapshotId: second.snapshotId,
      catalogFingerprint: second.catalogFingerprint,
      artifactSha256: second.artifactSha256,
      recordCount: second.recordCount,
      canonicalCount: second.canonicalCount,
      pluginsCount: second.pluginsCount,
      statsCount: second.statsCount,
      artifactUrl: pathToFileURL(join(secondDir, 'catalog.sqlite')).href,
    }
    writeFileSync(join(tempDir, 'catalog-release.json'), JSON.stringify(pointer))
    rmSync(join(tempDir, 'repos.json'))
    rmSync(join(tempDir, 'stats.json'))

    const refreshed = await prepareCatalog({ dataDir: tempDir })
    expect(refreshed.artifactSha256).toBe(second.artifactSha256)
    expect(refreshed.snapshotId).toBe(second.snapshotId)
  })
})
