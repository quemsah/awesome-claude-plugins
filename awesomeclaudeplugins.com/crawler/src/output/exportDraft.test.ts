import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { prepareDraft } from '../publish/publishRun.js'
import { openDatabase } from '../storage/db.js'
import { populateFixture } from '../storage/fixtureDb.js'
import { beginRun, completeRun } from '../storage/runs.js'
import { DraftExportError, exportDraftSnapshot } from './exportDraft.js'

const directories: string[] = []
const now = new Date('2026-09-23T12:00:00.000Z')

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'crawler-export-'))
  directories.push(dir)
  const db = openDatabase(join(dir, 'catalog.sqlite'))
  populateFixture(db)
  beginRun(db, 'prepared', now.toISOString())
  completeRun(db, 'prepared', now.toISOString(), 0)
  prepareDraft(db, 'prepared', now)
  return { dir, db }
}

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true })
})

it('exports exactly the verified README and JSON files to a new directory without touching SQLite', async () => {
  const { dir, db } = await fixture()
  try {
    const out = join(dir, 'draft')
    const before = db.serialize()
    exportDraftSnapshot(db, 'prepared', out)
    expect(readFileSync(join(out, 'README.md'), 'utf8')).toContain('with 2 total repositories indexed.')
    expect(JSON.parse(readFileSync(join(out, 'ui/src/data/repos.json'), 'utf8'))).toHaveLength(2)
    expect(JSON.parse(readFileSync(join(out, 'ui/src/data/stats.json'), 'utf8'))).toHaveLength(3)
    expect(JSON.parse(readFileSync(join(out, 'ui/src/data/markdown-paths.json'), 'utf8'))).toEqual([])
    expect(JSON.parse(readFileSync(join(out, 'ui/src/data/search-index.json'), 'utf8')).rows).toHaveLength(2)
    expect(existsSync(join(out, 'ui/src/data/repo-details'))).toBe(true)
    expect(db.serialize()).toEqual(before)
    expect(() => exportDraftSnapshot(db, 'prepared', out)).toThrow()
  } finally {
    db.close()
  }
})

it('refuses a changed draft before creating the output directory', async () => {
  const { dir, db } = await fixture()
  try {
    db.prepare('UPDATE repositories SET description = ? WHERE id = 1').run('changed')
    const out = join(dir, 'draft')
    expect(() => exportDraftSnapshot(db, 'prepared', out)).toThrow(/snapshot_changed/)
    expect(() => readFileSync(join(out, 'README.md'), 'utf8')).toThrow()
  } finally {
    db.close()
  }
})

it('refuses to export under the live UI directory', async () => {
  const { db } = await fixture()
  try {
    expect(() => exportDraftSnapshot(db, 'prepared', join(import.meta.dirname, '../../../ui/src/data/draft'))).toThrow()
  } finally {
    db.close()
  }
})

it('exports verified SQLite artifact and catalog-release.json alongside snapshot', async () => {
  const { dir, db } = await fixture()
  try {
    const artifactOutputPath = join(dir, 'source-catalog.sqlite')
    const releasePointerPath = join(dir, 'source-release.json')
    prepareDraft(db, 'prepared', now, { artifactOutputPath, releasePointerPath })

    const out = join(dir, 'sqlite-draft')
    exportDraftSnapshot(db, 'prepared', out)
    expect(existsSync(join(out, 'ui/catalog-release.json'))).toBe(true)
    expect(existsSync(join(out, 'ui/src/data/catalog.sqlite'))).toBe(true)
    const pointer = JSON.parse(readFileSync(join(out, 'ui/catalog-release.json'), 'utf8')) as { snapshotId?: string }
    expect(pointer.snapshotId).toBeDefined()
  } finally {
    db.close()
  }
})

it('refuses to export if the SQLite artifact is missing', async () => {
  const { dir, db } = await fixture()
  try {
    const artifactOutputPath = join(dir, 'source-catalog.sqlite')
    const releasePointerPath = join(dir, 'source-release.json')
    prepareDraft(db, 'prepared', now, { artifactOutputPath, releasePointerPath })

    // Remove the generated artifact
    rmSync(artifactOutputPath)

    const out = join(dir, 'missing-artifact-draft')
    expect(() => exportDraftSnapshot(db, 'prepared', out)).toThrow(DraftExportError)
    expect(existsSync(out)).toBe(false)
  } finally {
    db.close()
  }
})

it('refuses to export if the SQLite artifact SHA-256 mismatches', async () => {
  const { dir, db } = await fixture()
  try {
    const artifactOutputPath = join(dir, 'source-catalog.sqlite')
    const releasePointerPath = join(dir, 'source-release.json')
    prepareDraft(db, 'prepared', now, { artifactOutputPath, releasePointerPath })

    // Tamper with the artifact content
    writeFileSync(artifactOutputPath, 'corrupted content')

    const out = join(dir, 'tampered-artifact-draft')
    expect(() => exportDraftSnapshot(db, 'prepared', out)).toThrow(DraftExportError)
    expect(existsSync(out)).toBe(false)
  } finally {
    db.close()
  }
})
