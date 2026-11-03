import { existsSync, readFileSync } from 'node:fs'
import Database from 'better-sqlite3'

/** Pure, testable IndexNow state persistence and network submission helpers. */
export function deserializeBaseline(json) {
  const baseline = JSON.parse(json)
  if (
    !baseline ||
    typeof baseline !== 'object' ||
    baseline.version !== 1 ||
    !baseline.records ||
    typeof baseline.records !== 'object' ||
    Array.isArray(baseline.records)
  ) {
    throw new Error('Invalid IndexNow baseline; run workflow_dispatch with mode=full to replace it.')
  }
  const records = new Map()
  for (const [key, record] of Object.entries(baseline.records)) {
    if (!record || typeof record.fingerprint !== 'string' || !record.fingerprint || typeof record.url !== 'string' || !record.url) {
      throw new Error(`Invalid IndexNow baseline record for ${key}; run mode=full to replace it.`)
    }
    records.set(key, record)
  }
  return records
}

export function serializeBaseline(records, includedUrls = null) {
  const filtered = [...records].filter(([, record]) => includedUrls === null || includedUrls.has(record.url))
  return `${JSON.stringify({ version: 1, records: Object.fromEntries(filtered) })}\n`
}

function initSqliteBaseline(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS records (
      key TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      fingerprint TEXT NOT NULL
    );
  `)
}

export function loadBaseline(filePathOrDb) {
  if (typeof filePathOrDb === 'string') {
    if (!existsSync(filePathOrDb)) {
      throw new Error(`Baseline file does not exist: ${filePathOrDb}`)
    }
    // Check if it's a legacy JSON file
    try {
      const head = readFileSync(filePathOrDb, { encoding: 'utf8', flag: 'r' })
      if (head.trimStart().startsWith('{')) {
        return deserializeBaseline(head)
      }
    } catch (err) {
      if (err instanceof SyntaxError) throw err
      // If reading as text threw something else, might be binary SQLite
    }
  }

  const db = typeof filePathOrDb === 'string' ? new Database(filePathOrDb, { readonly: true }) : filePathOrDb
  try {
    initSqliteBaseline(db)
    const rows = db.prepare('SELECT key, url, fingerprint FROM records').all()
    const records = new Map()
    for (const row of rows) {
      records.set(row.key, { url: row.url, fingerprint: row.fingerprint })
    }
    return records
  } finally {
    if (typeof filePathOrDb === 'string') {
      db.close()
    }
  }
}

export function saveBaseline(filePathOrDb, records, includedUrls = null) {
  const db = typeof filePathOrDb === 'string' ? new Database(filePathOrDb) : filePathOrDb
  try {
    initSqliteBaseline(db)
    const filtered = [...records].filter(([, record]) => includedUrls === null || includedUrls.has(record.url))
    const existing = db.prepare('SELECT key, url, fingerprint FROM records').all()
    if (existing.length === filtered.length) {
      const existingMap = new Map(existing.map((r) => [r.key, r]))
      const isIdentical = filtered.every(([key, record]) => {
        const prev = existingMap.get(key)
        return prev && prev.url === record.url && prev.fingerprint === record.fingerprint
      })
      if (isIdentical) {
        return
      }
    }
    const insertTx = db.transaction(() => {
      db.prepare('DELETE FROM records').run()
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('version', '1'), ('updated_at', ?)").run(new Date().toISOString())
      const insert = db.prepare('INSERT INTO records (key, url, fingerprint) VALUES (?, ?, ?)')
      for (const [key, record] of filtered) {
        insert.run(key, record.url, record.fingerprint)
      }
    })
    insertTx()
  } finally {
    if (typeof filePathOrDb === 'string') {
      db.close()
    }
  }
}

export async function sendIndexNowBatch(urls, { siteUrl, key, keyLocation }, fetcher = fetch) {
  const response = await fetcher('https://api.indexnow.org/indexnow', {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: new URL(siteUrl).host, key, keyLocation, urlList: urls }),
  })
  if (!response.ok) {
    const details = await response.text()
    throw new Error(`IndexNow rejected the request: ${response.status} ${response.statusText}${details ? ` - ${details}` : ''}`)
  }
}
