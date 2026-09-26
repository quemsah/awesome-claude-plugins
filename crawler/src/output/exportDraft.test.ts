import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { prepareDraft } from '../publish/publishRun.js'
import { openDatabase } from '../storage/db.js'
import { populateFixture } from '../storage/fixtureDb.js'
import { beginRun, completeRun } from '../storage/runs.js'
import { exportDraftSnapshot } from './exportDraft.js'

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
