import type Database from 'better-sqlite3'

const schemaVersion = 9

function createSchema(db: Database.Database): void {
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
}

function migrateTo2(db: Database.Database): void {
  db.exec(`
    ALTER TABLE runs ADD COLUMN draft_date TEXT;
    ALTER TABLE runs ADD COLUMN draft_id INTEGER CHECK(draft_id > 0);
    ALTER TABLE runs ADD COLUMN draft_size INTEGER CHECK(draft_size >= 0);
    ALTER TABLE runs ADD COLUMN draft_hash TEXT;
    PRAGMA user_version = 2;
  `)
}

function migrateTo3(db: Database.Database): void {
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

type RepositoryMigrationRow = {
  id: number
  html_url: string
  stargazers_count: number | null
  forks_count: number | null
  subscribers_count: number | null
  description: string | null
  owner: string | null
  owner_url: string | null
  repo_name: string | null
  repo_updated: string | null
  plugins_count: number | null
}

function migrateDuplicateGroup(db: Database.Database, htmlUrl: string): void {
  const rows = db
    .prepare(`
      SELECT id, html_url, stargazers_count, forks_count, subscribers_count, description, owner, owner_url,
             repo_name, repo_updated, plugins_count
      FROM repositories
      WHERE html_url = ? COLLATE NOCASE
      ORDER BY
        ((owner IS NOT NULL) + (repo_name IS NOT NULL) + (owner_url IS NOT NULL) +
         (stargazers_count IS NOT NULL) + (forks_count IS NOT NULL) +
         (subscribers_count IS NOT NULL) + (repo_updated IS NOT NULL) +
         (plugins_count IS NOT NULL)) DESC,
        repo_updated DESC,
        id ASC
    `)
    .all(htmlUrl) as RepositoryMigrationRow[]
  const preferred = rows[0]
  if (!preferred) return
  const keeper = rows.reduce((oldest, row) => (row.id < oldest.id ? row : oldest))

  for (const duplicate of rows) {
    if (duplicate.id === keeper.id) continue
    db.prepare('UPDATE run_errors SET repository_id = ? WHERE repository_id = ?').run(keeper.id, duplicate.id)
    db.prepare('DELETE FROM repositories WHERE id = ?').run(duplicate.id)
  }

  db.prepare(`
    UPDATE repositories SET
      html_url = ?,
      stargazers_count = ?,
      forks_count = ?,
      subscribers_count = ?,
      description = ?,
      owner = ?,
      owner_url = ?,
      repo_name = ?,
      repo_updated = ?,
      plugins_count = ?
    WHERE id = ?
  `).run(
    preferred.html_url,
    preferred.stargazers_count,
    preferred.forks_count,
    preferred.subscribers_count,
    preferred.description,
    preferred.owner,
    preferred.owner_url,
    preferred.repo_name,
    preferred.repo_updated,
    preferred.plugins_count,
    keeper.id,
  )
}

function migrateTo4(db: Database.Database): void {
  const duplicateGroups = db
    .prepare(`
      SELECT html_url
      FROM repositories
      WHERE html_url IS NOT NULL
      GROUP BY html_url COLLATE NOCASE
      HAVING COUNT(*) > 1
    `)
    .all() as { html_url: string }[]

  for (const { html_url: htmlUrl } of duplicateGroups) migrateDuplicateGroup(db, htmlUrl)

  db.exec(`
    CREATE UNIQUE INDEX repositories_html_url_nocase_unique
      ON repositories(html_url COLLATE NOCASE)
      WHERE html_url IS NOT NULL;
    PRAGMA user_version = 4;
  `)
}

function migrateTo5(db: Database.Database): void {
  db.exec(`
    ALTER TABLE repositories ADD COLUMN marketplace_etag TEXT;
    PRAGMA user_version = 5;
  `)
}

function hasColumn(db: Database.Database, name: string): boolean {
  return (db.pragma('table_info(repositories)') as Array<{ name: string }>).some((column) => column.name === name)
}

function migrateTo6(db: Database.Database): void {
  for (const column of ['github_node_id', 'marketplace_oid', 'repository_etag']) {
    if (!hasColumn(db, column)) db.exec(`ALTER TABLE repositories ADD COLUMN ${column} TEXT`)
  }
  db.pragma('user_version = 6')
}

function migrateTo7(db: Database.Database): void {
  if (!hasColumn(db, 'marketplace_parser_version')) {
    db.exec('ALTER TABLE repositories ADD COLUMN marketplace_parser_version INTEGER CHECK(marketplace_parser_version >= 1)')
  }
  db.pragma('user_version = 7')
}

function migrateTo8(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS discovery_ranges (
      root_start INTEGER NOT NULL CHECK(root_start >= 0),
      root_end INTEGER NOT NULL CHECK(root_end >= root_start),
      range_start INTEGER NOT NULL CHECK(range_start >= root_start),
      range_end INTEGER NOT NULL CHECK(range_end >= range_start AND range_end <= root_end),
      PRIMARY KEY (root_start, root_end, range_start, range_end)
    );
    PRAGMA user_version = 8;
  `)
}

function migrateTo9(db: Database.Database): void {
  if (!hasColumn(db, 'marketplace_failed_oid')) db.exec('ALTER TABLE repositories ADD COLUMN marketplace_failed_oid TEXT')
  if (!hasColumn(db, 'marketplace_failed_parser_version')) {
    db.exec('ALTER TABLE repositories ADD COLUMN marketplace_failed_parser_version INTEGER CHECK(marketplace_failed_parser_version >= 1)')
  }
  db.pragma('user_version = 9')
}

function migrateSchema(db: Database.Database, version: number): void {
  if (version === 0) createSchema(db)
  if (version < 2) migrateTo2(db)
  if (version < 3) migrateTo3(db)
  if (version < 4) migrateTo4(db)
  if (version < 5) migrateTo5(db)
  if (version < 6) migrateTo6(db)
  if (version < 7) migrateTo7(db)
  if (version < 8) migrateTo8(db)
  if (version < 9) migrateTo9(db)
}

export function initializeSchema(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number
  if (version > schemaVersion) throw new Error(`Unsupported SQLite schema version: ${version}`)
  if (version === schemaVersion) return
  db.transaction(() => migrateSchema(db, version))()
}
