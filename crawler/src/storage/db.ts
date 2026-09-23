import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import Database from 'better-sqlite3'
import { initializeSchema } from './schema.js'

function isWithinData(path: string): boolean {
  const remainder = relative('/data', path)
  return remainder !== '' && remainder !== '..' && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder)
}

export function assertRailwayVolume(dbPath: string, mountInfo: string): void {
  if (!isAbsolute(dbPath) || !isWithinData(resolve(dbPath))) {
    throw new Error('Railway DB_PATH must be an absolute database file inside /data')
  }

  const dataMounted = mountInfo.split('\n').some((line) => line.split(' - ', 1)[0]?.split(' ')[4] === '/data')
  if (!dataMounted) {
    throw new Error('Railway /data must be a separate mounted volume before opening the database')
  }
}

export function assertRailwayTarget(dbPath: string, realDirectory: string): void {
  if (!isWithinData(resolve(dbPath)) || (realDirectory !== '/data' && !isWithinData(realDirectory))) {
    throw new Error('Railway DB_PATH resolves outside the mounted /data volume')
  }
}

export function openDatabase(
  dbPath: string = process.env.DB_PATH ?? '',
  options: { railway?: boolean; mountInfo?: string } = {},
): Database.Database {
  const railway =
    options.railway === true ||
    Boolean(process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_SERVICE_ID)

  if (railway) {
    if (!isAbsolute(dbPath) || !isWithinData(resolve(dbPath))) {
      throw new Error('Railway DB_PATH must be an absolute database file inside /data')
    }
    let mountInfo = options.mountInfo
    if (mountInfo === undefined) {
      try {
        mountInfo = readFileSync('/proc/self/mountinfo', 'utf8')
      } catch {
        throw new Error('Cannot verify Railway /data mount; refusing to open the database')
      }
    }
    assertRailwayVolume(dbPath, mountInfo)

    if (lstatSync(dbPath, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error('Railway DB_PATH must not be a symbolic link')
    }
    assertRailwayTarget(dbPath, realpathSync(dirname(dbPath)))
  } else if (!dbPath) {
    throw new Error('DB_PATH is required to open the database')
  }

  const db = new Database(dbPath)
  try {
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.pragma('busy_timeout = 5000')
    initializeSchema(db)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}
