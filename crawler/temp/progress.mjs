import Database from 'better-sqlite3'

const [dbPath] = process.argv.slice(2)
if (!dbPath) throw new Error('Usage: progress.mjs <database-path>')

const db = new Database(dbPath, { readonly: true, fileMustExist: true })
try {
  const run =
    db.prepare("SELECT run_id, status, started_at, heartbeat_at, completed_at FROM runs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1").get() ??
    db.prepare('SELECT run_id, status, started_at, heartbeat_at, completed_at FROM runs ORDER BY started_at DESC LIMIT 1').get()
  const durationMs = run
    ? Math.max(0, Date.parse(run.completed_at ?? new Date().toISOString()) - Date.parse(run.started_at))
    : null
  const total = db.prepare('SELECT count(*) AS count FROM repositories').get().count
  const enriched = db
    .prepare('SELECT count(*) AS count FROM repositories WHERE stargazers_count IS NOT NULL AND forks_count IS NOT NULL AND subscribers_count IS NOT NULL')
    .get().count
  const marketplaceCounted = db.prepare('SELECT count(*) AS count FROM repositories WHERE plugins_count IS NOT NULL').get().count
  const events = run
    ? db
        .prepare('SELECT phase, error_type AS type, count(*) AS count FROM run_errors WHERE run_id = ? GROUP BY phase, error_type ORDER BY phase, error_type')
        .all(run.run_id)
    : []

  // ponytail: infer the sequential phase from persisted enrichment fields; add explicit phase state if the crawl phases become concurrent.
  const phase = run?.status === 'running' ? (enriched > 0 ? 'enrichment' : 'discovery') : (run?.status ?? 'starting')
  console.log(JSON.stringify({ runId: run?.run_id ?? null, status: run?.status ?? 'starting', phase, total, enriched, pending: Math.max(0, total - enriched), marketplaceCounted, heartbeatAt: run?.heartbeat_at ?? null, durationMs, events }))
} finally {
  db.close()
}
