import type Database from 'better-sqlite3'

const schemaVersion = 3

export function initializeSchema(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number
  if (version > schemaVersion) throw new Error(`Unsupported SQLite schema version: ${version}`)
  if (version === schemaVersion) return

  db.transaction(() => {
    if (version === 0)
      db.exec(`
      CREATE TABLE repositories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        html_url TEXT UNIQUE,
        stargazers_count INTEGER,
        forks_count INTEGER,
        subscribers_count INTEGER,
        description TEXT,
        owner TEXT,
        owner_url TEXT,
        repo_name TEXT,
        repo_updated TEXT,
        plugins_count INTEGER,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      CREATE TABLE runs (
        run_id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'published')),
        started_at TEXT NOT NULL,
        heartbeat_at TEXT NOT NULL,
        completed_at TEXT,
        published_at TEXT,
        commit_sha TEXT,
        pending_commit_sha TEXT,
        warning_count INTEGER NOT NULL DEFAULT 0 CHECK(warning_count >= 0),
        last_error TEXT
      );
      CREATE UNIQUE INDEX runs_single_active ON runs(status) WHERE status = 'running';
      CREATE TABLE stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        size INTEGER NOT NULL CHECK(size >= 0),
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        run_id TEXT UNIQUE REFERENCES runs(run_id)
      );
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE run_errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES runs(run_id),
        phase TEXT NOT NULL,
        repository_id INTEGER,
        range_start INTEGER,
        range_end INTEGER,
        error_type TEXT NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count >= 0),
        occurred_at TEXT NOT NULL
      );
      CREATE INDEX run_errors_by_run ON run_errors(run_id, id);
      PRAGMA user_version = 1;
    `)
    if (version < 2)
      db.exec(`
      ALTER TABLE runs ADD COLUMN draft_date TEXT;
      ALTER TABLE runs ADD COLUMN draft_id INTEGER CHECK(draft_id > 0);
      ALTER TABLE runs ADD COLUMN draft_size INTEGER CHECK(draft_size >= 0);
      ALTER TABLE runs ADD COLUMN draft_hash TEXT;
      PRAGMA user_version = 2;
    `)
    if (version < 3) {
      const pending = db.prepare('SELECT run_id, status FROM runs WHERE pending_commit_sha IS NOT NULL').all() as {
        run_id: string
        status: string
      }[]
      if (pending.length > 1 || (pending.length === 1 && pending[0].status !== 'completed')) {
        throw new Error('Cannot migrate ambiguous pending Git publication; reconcile the runs before upgrading')
      }
      db.exec(`
      CREATE TABLE publication_lease (
        slot INTEGER PRIMARY KEY CHECK(slot = 1),
        run_id TEXT NOT NULL REFERENCES runs(run_id),
        owner TEXT NOT NULL
      );
      INSERT INTO publication_lease (slot, run_id, owner)
        SELECT 1, run_id, 'migration_recovery' FROM runs WHERE pending_commit_sha IS NOT NULL;
      PRAGMA user_version = 3;
    `)
    }
  })()
}
