import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import type Database from 'better-sqlite3'
import { parse } from 'csv-parse'

const repoColumns = [
  'id',
  'html_url',
  'stargazers_count',
  'forks_count',
  'subscribers_count',
  'description',
  'owner',
  'owner_url',
  'repo_name',
  'repo_updated',
  'plugins_count',
  'createdAt',
  'updatedAt',
] as const
const statsColumns = ['id', 'date', 'size', 'createdAt', 'updatedAt'] as const
const seedKeys = ['seed_repos_sha256', 'seed_stats_sha256', 'seed_repos_count', 'seed_stats_count'] as const

type Files = { reposPath: string; statsPath: string }
type SeedMode = 'seed' | 'seed-if-empty'
type SeedResult = { status: 'imported' | 'already-imported' }

export class CsvValidationError extends Error {
  constructor(
    readonly table: 'repos' | 'stats',
    readonly row: number,
    readonly column: number,
    message: string,
  ) {
    super(message)
    this.name = 'CsvValidationError'
  }
}

function integer(value: string, table: string, row: number, column: number, nullable = false, signed = false): number | null {
  if (nullable && value === '') return null
  if (!(signed ? /^-?(0|[1-9][0-9]*)$/ : /^(0|[1-9][0-9]*)$/).test(value)) {
    throw new Error(`${table} row ${row} column ${column}: expected a ${signed ? 'signed' : 'non-negative'} integer`)
  }
  const number = Number(value)
  if (!Number.isSafeInteger(number) || (column === 1 && number === 0)) {
    throw new Error(`${table} row ${row} column ${column}: integer out of range`)
  }
  return number
}

function required(value: string, table: string, row: number, column: number): string {
  if (!value) throw new Error(`${table} row ${row} column ${column}: required field is empty`)
  return value
}

function optional(value: string): string | null {
  return value === '' ? null : value
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function loadFile(
  path: string,
  table: 'repos' | 'stats',
  headers: readonly string[],
  insert: (fields: string[], row: number) => void,
): Promise<{ hash: string; count: number }> {
  const hash = createHash('sha256')
  const source = createReadStream(path)
  const parser = parse({ bom: true, relax_quotes: false, skip_empty_lines: false, relax_column_count: true })
  source.on('data', (chunk: string | Buffer) => {
    hash.update(chunk)
  })
  source.on('error', (error) => parser.destroy(error))
  source.pipe(parser)
  let row = 0
  try {
    for await (const fields of parser as AsyncIterable<string[]>) {
      row++
      if (row === 1) {
        const difference = headers.findIndex((header, index) => fields[index] !== header)
        const column = difference === -1 ? Math.min(fields.length, headers.length) + 1 : difference + 1
        if (difference !== -1 || fields.length !== headers.length) {
          throw new Error(`${table} row 1 column ${column}: unexpected CSV header`)
        }
      } else {
        if (fields.length !== headers.length) {
          throw new Error(
            `${table} row ${row} column ${Math.min(fields.length, headers.length) + 1}: expected ${headers.length} columns, received ${fields.length}`,
          )
        }
        insert(fields, row)
      }
    }
    if (row === 0) throw new Error(`${table} row 1 column 1: missing CSV header`)
    return { hash: hash.digest('hex'), count: row - 1 }
  } catch (error) {
    if (error instanceof Error) {
      const location = /^(repos|stats) row (\d+) column (\d+):/.exec(error.message)
      if (location?.[1] === table) {
        throw new CsvValidationError(table, Number(location[2]), Number(location[3]), error.message)
      }
    }
    if (error instanceof Error && 'code' in error && String(error.code).startsWith('CSV_')) {
      const column = (error as { column?: number }).column
      const index = typeof column === 'number' ? column + 1 : 1
      throw new CsvValidationError(table, row + 1, index, `${table} row ${row + 1} column ${index}: malformed CSV (${String(error.code)})`)
    }
    throw error
  } finally {
    source.destroy()
    parser.destroy()
  }
}

export async function importCsv(db: Database.Database, files: Files, mode: SeedMode = 'seed'): Promise<SeedResult> {
  db.exec('BEGIN IMMEDIATE')
  try {
    const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?')
    const settings = seedKeys.map((key) => (getSetting.get(key) as { value: string } | undefined)?.value)
    const counts = db
      .prepare(`
      SELECT (SELECT COUNT(*) FROM repositories) AS repos, (SELECT COUNT(*) FROM stats) AS stats,
             (SELECT COUNT(*) FROM runs) AS runs
    `)
      .get() as { repos: number; stats: number; runs: number }
    const seeded = settings.every((value) => value !== undefined)
    if (settings.some((value) => value !== undefined) && !seeded) {
      throw new Error('Partial seed metadata; refusing to overwrite a potentially populated database')
    }
    if (seeded) {
      if (counts.runs === 0 && (counts.repos !== Number(settings[2]) || counts.stats !== Number(settings[3]))) {
        throw new Error('Inconsistent partial seed: imported row counts have changed without a crawl')
      }
      if (mode === 'seed-if-empty') {
        db.exec('COMMIT')
        return { status: 'already-imported' }
      }
      const reposHash = await hashFile(files.reposPath)
      const statsHash = await hashFile(files.statsPath)
      if (reposHash !== settings[0] || statsHash !== settings[1]) {
        throw new Error('Seed files have different hashes; refusing to overwrite imported data')
      }
      db.exec('COMMIT')
      return { status: 'already-imported' }
    }
    if (counts.repos !== 0 || counts.stats !== 0 || counts.runs !== 0) {
      throw new Error('Unseeded or partially populated database; refusing CSV import')
    }

    const repoInsert = db.prepare(`
      INSERT INTO repositories (${repoColumns.join(', ')})
      VALUES (${repoColumns.map(() => '?').join(', ')})
    `)
    const statsInsert = db.prepare(`
      INSERT INTO stats (${statsColumns.join(', ')})
      VALUES (${statsColumns.map(() => '?').join(', ')})
    `)
    const repos = await loadFile(files.reposPath, 'repos', repoColumns, (f, row) => {
      const values = [
        integer(f[0], 'repos', row, 1),
        optional(f[1]),
        integer(f[2], 'repos', row, 3, true, true),
        integer(f[3], 'repos', row, 4, true, true),
        integer(f[4], 'repos', row, 5, true, true),
        optional(f[5]),
        optional(f[6]),
        optional(f[7]),
        optional(f[8]),
        optional(f[9]),
        integer(f[10], 'repos', row, 11, true, true),
        required(f[11], 'repos', row, 12),
        required(f[12], 'repos', row, 13),
      ]
      try {
        repoInsert.run(...values)
      } catch (error) {
        if (error instanceof Error && error.message.includes('repositories.id')) throw new Error(`repos row ${row} column 1: duplicate ID`)
        if (error instanceof Error && error.message.includes('repositories.html_url'))
          throw new Error(`repos row ${row} column 2: duplicate URL`)
        throw error
      }
    })
    const stats = await loadFile(files.statsPath, 'stats', statsColumns, (f, row) => {
      const values = [
        integer(f[0], 'stats', row, 1),
        required(f[1], 'stats', row, 2),
        integer(f[2], 'stats', row, 3),
        required(f[3], 'stats', row, 4),
        required(f[4], 'stats', row, 5),
      ]
      try {
        statsInsert.run(...values)
      } catch (error) {
        if (error instanceof Error && error.message.includes('stats.id')) throw new Error(`stats row ${row} column 1: duplicate ID`)
        if (error instanceof Error && error.message.includes('stats.date')) throw new Error(`stats row ${row} column 2: duplicate date`)
        throw error
      }
    })
    const putSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
    for (const [key, value] of [
      [seedKeys[0], repos.hash],
      [seedKeys[1], stats.hash],
      [seedKeys[2], String(repos.count)],
      [seedKeys[3], String(stats.count)],
    ]) {
      putSetting.run(key, value)
    }
    db.exec('COMMIT')
    return { status: 'imported' }
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK')
    throw error
  }
}

export function inspect(db: Database.Database) {
  const counts = db
    .prepare(`
    SELECT (SELECT COUNT(*) FROM repositories) AS repositories,
           (SELECT COUNT(*) FROM repositories WHERE html_url IS NOT NULL) AS nonemptyUrls,
           (SELECT COUNT(*) FROM repositories WHERE html_url IS NULL) AS missingUrls,
           (SELECT COUNT(*) FROM stats) AS stats,
           (SELECT MIN(id) FROM repositories) AS minRepositoryId,
           (SELECT MAX(id) FROM repositories) AS maxRepositoryId,
           (SELECT MIN(id) FROM stats) AS minStatsId,
           (SELECT MAX(id) FROM stats) AS maxStatsId
  `)
    .get() as {
    repositories: number
    nonemptyUrls: number
    missingUrls: number
    stats: number
    minRepositoryId: number | null
    maxRepositoryId: number | null
    minStatsId: number | null
    maxStatsId: number | null
  }
  const stored = db.prepare(`SELECT key, value FROM settings WHERE key IN (${seedKeys.map(() => '?').join(', ')})`).all(...seedKeys) as {
    key: string
    value: string
  }[]
  const negativeLegacyCounters = db
    .prepare(`
      SELECT COUNT(*) FILTER (WHERE stargazers_count < 0 OR forks_count < 0 OR subscribers_count < 0 OR plugins_count < 0) AS rows,
             COUNT(*) FILTER (WHERE stargazers_count < 0) AS stargazers_count,
             COUNT(*) FILTER (WHERE forks_count < 0) AS forks_count,
             COUNT(*) FILTER (WHERE subscribers_count < 0) AS subscribers_count,
             COUNT(*) FILTER (WHERE plugins_count < 0) AS plugins_count
      FROM repositories
    `)
    .get() as {
    rows: number
    stargazers_count: number
    forks_count: number
    subscribers_count: number
    plugins_count: number
  }
  const settings = new Map(stored.map(({ key, value }) => [key, value]))
  const runs = db.prepare('SELECT COUNT(*) AS count FROM runs').get() as { count: number }
  const integrity = db.pragma('integrity_check', { simple: true }) as string
  const seeded = stored.length === seedKeys.length
  const partial =
    (stored.length > 0 && !seeded) ||
    (seeded &&
      runs.count === 0 &&
      (counts.repositories !== Number(settings.get('seed_repos_count')) || counts.stats !== Number(settings.get('seed_stats_count'))))
  return {
    ...counts,
    negativeLegacyCounters,
    integrity,
    state: partial ? 'partial' : seeded ? 'imported' : counts.repositories || counts.stats || runs.count ? 'unseeded' : 'empty',
  }
}
