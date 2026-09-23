import { createHash } from 'node:crypto'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from './db.js'
import { importCsv, inspect } from './importCsv.js'
import { listPublishable } from './repositories.js'

const scratch: string[] = []
const fixture = (file: string) => join(import.meta.dirname, '../../test/fixtures', file)

function setup() {
  const dir = mkdtempSync(join(import.meta.dirname, '../../test/.scratch-import-'))
  scratch.push(dir)
  const reposPath = join(dir, 'repos.csv')
  const statsPath = join(dir, 'stats.csv')
  copyFileSync(fixture('repos.csv'), reposPath)
  copyFileSync(fixture('stats.csv'), statsPath)
  const db = openDatabase(join(dir, 'catalog.sqlite'))
  return { db, reposPath, statsPath }
}

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('one-time CSV import', () => {
  it('preserves sparse IDs, original text, zeroes, nulls, dates, and hashes both source files', async () => {
    const { db, reposPath, statsPath } = setup()
    try {
      expect(await importCsv(db, { reposPath, statsPath })).toEqual({ status: 'imported' })
      expect(inspect(db)).toMatchObject({
        repositories: 5,
        nonemptyUrls: 3,
        missingUrls: 2,
        stats: 2,
        minRepositoryId: 1,
        maxRepositoryId: 14,
        minStatsId: 2,
        maxStatsId: 7,
        integrity: 'ok',
        state: 'imported',
      })
      expect(db.prepare('SELECT id, description, stargazers_count, plugins_count, createdAt FROM repositories WHERE id = 1').get()).toEqual(
        {
          id: 1,
          description: 'Quote "here", and\nanother line',
          stargazers_count: 0,
          plugins_count: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      )
      expect(db.prepare('SELECT owner FROM repositories WHERE id = 3').get()).toEqual({ owner: '123' })
      expect(db.prepare('SELECT html_url, stargazers_count, owner, description FROM repositories WHERE id = 8').get()).toEqual({
        html_url: 'https://github.com/missing/owner',
        stargazers_count: null,
        owner: null,
        description: 'no owner',
      })
      expect(db.prepare('SELECT html_url, description FROM repositories WHERE id = 10').get()).toEqual({
        html_url: null,
        description: null,
      })
      expect(db.prepare('SELECT html_url, description, forks_count FROM repositories WHERE id = 14').get()).toEqual({
        html_url: null,
        description: 'orphan',
        forks_count: 0,
      })
      db.prepare("INSERT INTO repositories (createdAt, updatedAt) VALUES ('new', 'new')").run()
      expect(db.prepare('SELECT MAX(id) AS maxId FROM repositories').get()).toEqual({ maxId: 15 })
      expect(db.prepare('SELECT id, date, size, createdAt, updatedAt FROM stats ORDER BY id').all()).toEqual([
        { id: 2, date: '2026-01-10T00:00:00.000Z', size: 0, createdAt: '2026-01-10T01:00:00.000Z', updatedAt: '2026-01-10T01:00:00.000Z' },
        { id: 7, date: '2026-01-11T00:00:00.000Z', size: 3, createdAt: '2026-01-11T01:00:00.000Z', updatedAt: '2026-01-11T01:00:00.000Z' },
      ])
      for (const [key, file] of [
        ['seed_repos_sha256', reposPath],
        ['seed_stats_sha256', statsPath],
      ]) {
        expect(db.prepare('SELECT value FROM settings WHERE key = ?').get(key)).toEqual({
          value: createHash('sha256').update(readFileSync(file)).digest('hex'),
        })
      }
    } finally {
      db.close()
    }
  })

  it('does not overwrite enriched rows when the same CSVs are seeded again', async () => {
    const { db, reposPath, statsPath } = setup()
    try {
      await importCsv(db, { reposPath, statsPath })
      db.prepare("UPDATE repositories SET description = 'enriched' WHERE id = 1").run()
      expect(await importCsv(db, { reposPath, statsPath })).toEqual({ status: 'already-imported' })
      expect(db.prepare('SELECT description FROM repositories WHERE id = 1').get()).toEqual({ description: 'enriched' })
      writeFileSync(reposPath, readFileSync(reposPath, 'utf8').replace('plain', 'changed'))
      await expect(importCsv(db, { reposPath, statsPath })).rejects.toThrow(/different.*hash|hash.*different/i)
      writeFileSync(reposPath, 'not a valid CSV header\n')
      await expect(importCsv(db, { reposPath, statsPath })).rejects.toThrow(/different.*hash|hash.*different/i)
      expect(db.prepare('SELECT description FROM repositories WHERE id = 1').get()).toEqual({ description: 'enriched' })
    } finally {
      db.close()
    }
  })

  it('preserves signed legacy repository counters, reports their totals, and excludes the row from publication', async () => {
    const { db, reposPath, statsPath } = setup()
    try {
      const csv = readFileSync(reposPath, 'utf8')
        .replace('0,2,3,"Quote', '-1,-2,-3,"Quote')
        .replace('2026-01-02T03:04:05.000Z,0,', '2026-01-02T03:04:05.000Z,-4,')
      writeFileSync(reposPath, csv)

      expect(await importCsv(db, { reposPath, statsPath })).toEqual({ status: 'imported' })
      expect(
        db.prepare('SELECT stargazers_count, forks_count, subscribers_count, plugins_count FROM repositories WHERE id = 1').get(),
      ).toEqual({ stargazers_count: -1, forks_count: -2, subscribers_count: -3, plugins_count: -4 })
      expect(inspect(db).negativeLegacyCounters).toEqual({
        rows: 1,
        stargazers_count: 1,
        forks_count: 1,
        subscribers_count: 1,
        plugins_count: 1,
      })
      expect(listPublishable(db).map(({ id }) => id)).toEqual([3])
    } finally {
      db.close()
    }
  })

  it('refuses partial or unseeded data; seed-if-empty only skips a complete seed', async () => {
    const { db, reposPath, statsPath } = setup()
    try {
      await expect(importCsv(db, { reposPath: join(import.meta.dirname, 'missing.csv'), statsPath }, 'seed-if-empty')).rejects.toThrow()
      await importCsv(db, { reposPath, statsPath })
      expect(await importCsv(db, { reposPath: 'missing.csv', statsPath: 'missing.csv' }, 'seed-if-empty')).toEqual({
        status: 'already-imported',
      })
      db.prepare('DELETE FROM stats WHERE id = 7').run()
      expect(inspect(db).state).toBe('partial')
      await expect(importCsv(db, { reposPath, statsPath }, 'seed-if-empty')).rejects.toThrow(/partial|inconsistent/i)
    } finally {
      db.close()
    }
    const second = setup()
    try {
      second.db.prepare("INSERT INTO settings (key, value) VALUES ('unrelated', 'keep')").run()
      second.db.prepare("INSERT INTO repositories (id, createdAt, updatedAt) VALUES (99, 'a', 'b')").run()
      await expect(importCsv(second.db, second, 'seed-if-empty')).rejects.toThrow(/partial|unseeded|populated/i)
      expect(second.db.prepare('SELECT id FROM repositories').all()).toEqual([{ id: 99 }])
    } finally {
      second.db.close()
    }
  })

  it.each([
    ['wrong header', 'repos', (text: string) => text.replace('html_url', 'url'), /repos.*row 1.*column 2/i],
    ['duplicate ID', 'repos', (text: string) => text.replace(/^3,https:/m, '1,https:'), /repos.*row 3.*column 1/i],
    [
      'duplicate URL',
      'repos',
      (text: string) => text.replace('https://github.com/123/project', 'https://github.com/alpha/repo'),
      /repos.*row 3.*column 2/i,
    ],
    ['fractional counter', 'repos', (text: string) => text.replace('99,0,1,plain', '1.5,0,1,plain'), /repos.*row 3.*column 3/i],
    ['negative repository ID', 'repos', (text: string) => text.replace(/^3,https:/m, '-3,https:'), /repos.*row 3.*column 1/i],
    ['negative stats size', 'stats', (text: string) => text.replace(',3,2026-01-11', ',-3,2026-01-11'), /stats.*row 3.*column 3/i],
    ['overflow counter', 'repos', (text: string) => text.replace('99,0,1,plain', '9007199254740992,0,1,plain'), /repos.*row 3.*column 3/i],
    [
      'negative overflow counter',
      'repos',
      (text: string) => text.replace('99,0,1,plain', '-9007199254740992,0,1,plain'),
      /repos.*row 3.*column 3/i,
    ],
    ['invalid quote', 'repos', (text: string) => text.replace('99,0,1,plain', '99,0,1,"unterminated'), /repos.*row 3.*column 6/i],
    ['missing column', 'repos', (text: string) => text.replace(',2026-01-04T00:00:00.000Z', ''), /repos.*row 3.*column \d+/i],
    ['bad stats', 'stats', (text: string) => text.replace(',3,2026-01-11', ',1.5,2026-01-11'), /stats.*row 3.*column 3/i],
  ])('rolls back both tables and hashes on %s', async (_name, file, change, message) => {
    const { db, reposPath, statsPath } = setup()
    try {
      const path = file === 'repos' ? reposPath : statsPath
      writeFileSync(path, change(readFileSync(path, 'utf8')))
      await expect(importCsv(db, { reposPath, statsPath })).rejects.toThrow(message)
      expect(db.prepare('SELECT COUNT(*) AS count FROM repositories').get()).toEqual({ count: 0 })
      expect(db.prepare('SELECT COUNT(*) AS count FROM stats').get()).toEqual({ count: 0 })
      expect(db.prepare("SELECT COUNT(*) AS count FROM settings WHERE key LIKE 'seed_%'").get()).toEqual({ count: 0 })
    } finally {
      db.close()
    }
  })

  it('includes structured row and column without exposing the invalid CSV value', async () => {
    const { db, reposPath, statsPath } = setup()
    try {
      writeFileSync(reposPath, readFileSync(reposPath, 'utf8').replace('99,0,1,plain', 'secret-value,0,1,plain'))
      await expect(importCsv(db, { reposPath, statsPath })).rejects.toMatchObject({
        table: 'repos',
        row: 3,
        column: 3,
      })
    } finally {
      db.close()
    }
  })
})
