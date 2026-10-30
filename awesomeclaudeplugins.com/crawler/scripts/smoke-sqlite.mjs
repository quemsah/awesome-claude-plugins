import Database from 'better-sqlite3'

const db = new Database(':memory:')
try {
  const row = db.prepare('SELECT 1 AS ready').get()
  if (row?.ready !== 1) throw new Error('Native SQLite smoke test returned an unexpected result')
  console.log('Native better-sqlite3 module loaded and query succeeded')
} finally {
  db.close()
}
