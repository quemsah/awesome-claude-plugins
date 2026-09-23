import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertRailwayTarget, assertRailwayVolume, openDatabase } from '../src/storage/db.js'

const directories: string[] = []

function databasePath(): string {
  const directory = mkdtempSync(join(import.meta.dirname, '.scratch-'))
  directories.push(directory)
  return join(directory, 'catalog.sqlite')
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('openDatabase', () => {
  it('persists data across close and reopen in a local directory', () => {
    const path = databasePath()
    const db = openDatabase(path)
    db.exec("CREATE TABLE example (value TEXT NOT NULL); INSERT INTO example VALUES ('persisted')")
    db.close()

    expect(existsSync(path)).toBe(true)
    const reopened = openDatabase(path)
    expect(reopened.prepare('SELECT value FROM example').get()).toEqual({ value: 'persisted' })
    reopened.close()
  })

  it('rejects a Railway DB_PATH outside /data before creating a database', () => {
    const path = databasePath()
    expect(() => openDatabase(path, { railway: true })).toThrow(/DB_PATH.*\/data/)
    expect(existsSync(path)).toBe(false)
  })

  it('detects Railway from its environment and rejects a local database', () => {
    const path = databasePath()
    const previous = process.env.RAILWAY_PROJECT_ID
    process.env.RAILWAY_PROJECT_ID = 'test-project'
    try {
      expect(() => openDatabase(path)).toThrow(/DB_PATH.*\/data/)
      expect(existsSync(path)).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.RAILWAY_PROJECT_ID
      else process.env.RAILWAY_PROJECT_ID = previous
    }
  })

  it('cannot disable the Railway guard through a local option', () => {
    const path = databasePath()
    const previous = process.env.RAILWAY_PROJECT_ID
    process.env.RAILWAY_PROJECT_ID = 'test-project'
    try {
      expect(() => openDatabase(path, { railway: false })).toThrow(/DB_PATH.*\/data/)
      expect(existsSync(path)).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.RAILWAY_PROJECT_ID
      else process.env.RAILWAY_PROJECT_ID = previous
    }
  })
})

describe('Railway volume guard', () => {
  const rootOnly = '28 23 0:25 / / rw,relatime - overlay overlay rw\n'
  const mountedData = `${rootOnly}29 28 0:30 / /data rw,relatime - ext4 /dev/volume rw\n`

  it('rejects /data when it is only a directory on the root filesystem', () => {
    expect(() => assertRailwayVolume('/data/catalog.sqlite', rootOnly)).toThrow(/\/data.*mount/)
  })

  it('does not create a Railway database when /data has no mount', () => {
    const path = `/data/crawler-stage1-guard-${process.pid}.sqlite`
    expect(existsSync(path)).toBe(false)
    expect(() => openDatabase(path, { railway: true, mountInfo: rootOnly })).toThrow(/separate mounted volume/)
    expect(existsSync(path)).toBe(false)
  })

  it('accepts a database path beneath an independently mounted /data', () => {
    expect(() => assertRailwayVolume('/data/catalog.sqlite', mountedData)).not.toThrow()
  })

  it('rejects paths that escape /data', () => {
    expect(() => assertRailwayVolume('/data/../catalog.sqlite', mountedData)).toThrow(/DB_PATH.*\/data/)
  })

  it('accepts the mount root as the database file parent', () => {
    expect(() => assertRailwayTarget('/data/catalog.sqlite', '/data')).not.toThrow()
  })

  it('rejects a database parent symlink resolved outside the mount', () => {
    expect(() => assertRailwayTarget('/data/linked/catalog.sqlite', '/outside')).toThrow(/outside.*\/data/)
  })
})
