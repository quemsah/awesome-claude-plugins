import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, expect, it } from 'vitest'
import { openDatabase } from './db.js'
import { initializeSchema } from './schema.js'

const directories: string[] = []

function database() {
  const directory = mkdtempSync(join(import.meta.dirname, '.schema-'))
  directories.push(directory)
  return openDatabase(join(directory, 'catalog.sqlite'))
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

it('initializes all tables and remains idempotent on reopen', () => {
  const db = database()
  const path = db.name
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  expect(tables).toEqual([
    { name: 'discovery_ranges' },
    { name: 'publication_lease' },
    { name: 'repositories' },
    { name: 'run_errors' },
    { name: 'runs' },
    { name: 'settings' },
    { name: 'stats' },
  ])
  expect(db.pragma('user_version', { simple: true })).toBe(12)
  const columns = db.prepare('PRAGMA table_info(repositories)').all() as Array<{ name: string }>
  expect(columns.map((row) => row.name)).toEqual(
    expect.arrayContaining([
      'github_node_id',
      'marketplace_oid',
      'repository_etag',
      'marketplace_etag',
      'marketplace_parser_version',
      'marketplace_failed_oid',
      'marketplace_failed_parser_version',
    ]),
  )
  const runColumns = db.prepare('PRAGMA table_info(runs)').all() as Array<{ name: string }>
  expect(runColumns.map((row) => row.name)).toEqual(expect.arrayContaining(['phase', 'phase_started_at', 'phase_total', 'phase_processed']))
  db.prepare("INSERT INTO repositories (id, html_url, createdAt, updatedAt) VALUES (400, NULL, '2024-01-01', '2024-01-02')").run()
  db.close()

  const reopened = openDatabase(path)
  expect(reopened.prepare('SELECT id, html_url, createdAt, updatedAt FROM repositories').all()).toEqual([
    { id: 400, html_url: null, createdAt: '2024-01-01', updatedAt: '2024-01-02' },
  ])
  reopened.close()
})

it('migrates populated v1 runs, imported IDs and historical stats atomically and only once', () => {
  const directory = mkdtempSync(join(import.meta.dirname, '.migration-'))
  directories.push(directory)
  const db = new Database(join(directory, 'catalog.sqlite'))
  try {
    db.exec(`
      CREATE TABLE repositories (id INTEGER PRIMARY KEY, html_url TEXT, createdAt TEXT, updatedAt TEXT);
      CREATE TABLE runs (
        run_id TEXT PRIMARY KEY, status TEXT, started_at TEXT, heartbeat_at TEXT,
        completed_at TEXT, published_at TEXT, commit_sha TEXT, pending_commit_sha TEXT,
        warning_count INTEGER, last_error TEXT
      );
      CREATE TABLE stats (
        id INTEGER PRIMARY KEY, date TEXT UNIQUE, size INTEGER, createdAt TEXT,
        updatedAt TEXT, run_id TEXT
      );
      CREATE TABLE run_errors (
        id INTEGER PRIMARY KEY, run_id TEXT, phase TEXT, repository_id INTEGER,
        range_start INTEGER, range_end INTEGER, error_type TEXT, retry_count INTEGER, occurred_at TEXT
      );
      INSERT INTO repositories VALUES (53000, NULL, 'before', 'after');
      INSERT INTO runs VALUES ('old', 'completed', 'start', 'beat', 'done', NULL, NULL, NULL, 3, NULL);
      INSERT INTO stats VALUES (264, '2024-01-01', 42, 'before', 'after', NULL);
      PRAGMA user_version = 1;
    `)
    initializeSchema(db)
    initializeSchema(db)
    expect(db.pragma('user_version', { simple: true })).toBe(12)
    expect(db.prepare('SELECT id, createdAt FROM repositories').all()).toEqual([{ id: 53000, createdAt: 'before' }])
    expect(db.prepare('SELECT id, date, size FROM stats').all()).toEqual([{ id: 264, date: '2024-01-01', size: 42 }])
    expect(db.prepare('SELECT run_id, warning_count, draft_date, draft_id, draft_size, draft_hash FROM runs').all()).toEqual([
      { run_id: 'old', warning_count: 3, draft_date: null, draft_id: null, draft_size: null, draft_hash: null },
    ])
  } finally {
    db.close()
  }
})

it('upgrades a populated v2 database without changing drafts or pending commit SHAs', () => {
  const db = database()
  const path = db.name
  db.prepare(
    "INSERT INTO runs (run_id, status, started_at, heartbeat_at, completed_at, draft_hash, pending_commit_sha) VALUES ('pending', 'completed', 'now', 'now', 'now', ?, ?)",
  ).run('a'.repeat(64), 'b'.repeat(40))
  db.close()
  const old = new Database(path)
  old.exec(`
    DROP INDEX repositories_html_url_nocase_unique;
    DROP TABLE publication_lease;
    ALTER TABLE repositories DROP COLUMN marketplace_failed_parser_version;
    ALTER TABLE repositories DROP COLUMN marketplace_failed_oid;
    ALTER TABLE repositories DROP COLUMN marketplace_parser_version;
    ALTER TABLE repositories DROP COLUMN marketplace_etag;
    ALTER TABLE repositories DROP COLUMN repository_etag;
    ALTER TABLE repositories DROP COLUMN marketplace_oid;
    ALTER TABLE repositories DROP COLUMN github_node_id;
    DROP TABLE discovery_ranges;
    ALTER TABLE run_errors DROP COLUMN query_family;
    PRAGMA user_version = 2;
  `)
  old.close()
  const migrated = openDatabase(path)
  expect(migrated.pragma('user_version', { simple: true })).toBe(12)
  expect(migrated.prepare("SELECT draft_hash, pending_commit_sha FROM runs WHERE run_id = 'pending'").get()).toEqual({
    draft_hash: 'a'.repeat(64),
    pending_commit_sha: 'b'.repeat(40),
  })
  expect(migrated.prepare('SELECT run_id FROM publication_lease').get()).toEqual({ run_id: 'pending' })
  migrated.close()
})

it('upgrades main schema v5 while preserving its marketplace ETag', () => {
  const db = database()
  const path = db.name
  db.prepare(
    "INSERT INTO repositories (html_url, createdAt, updatedAt) VALUES ('https://github.com/acme/catalog', 'before', 'before')",
  ).run()
  db.prepare('UPDATE repositories SET marketplace_etag = \'W/"marketplace"\'').run()
  db.exec(`
    ALTER TABLE repositories DROP COLUMN marketplace_failed_parser_version;
    ALTER TABLE repositories DROP COLUMN marketplace_failed_oid;
    ALTER TABLE repositories DROP COLUMN marketplace_parser_version;
    ALTER TABLE repositories DROP COLUMN repository_etag;
    ALTER TABLE repositories DROP COLUMN marketplace_oid;
    ALTER TABLE repositories DROP COLUMN github_node_id;
    DROP TABLE discovery_ranges;
    ALTER TABLE run_errors DROP COLUMN query_family;
    PRAGMA user_version = 5;
  `)
  db.close()

  const migrated = openDatabase(path)
  expect(migrated.pragma('user_version', { simple: true })).toBe(12)
  expect(migrated.prepare('SELECT marketplace_etag FROM repositories').get()).toEqual({ marketplace_etag: 'W/"marketplace"' })
  expect((migrated.pragma('table_info(repositories)') as Array<{ name: string }>).map((column) => column.name)).toEqual(
    expect.arrayContaining([
      'github_node_id',
      'marketplace_oid',
      'repository_etag',
      'marketplace_parser_version',
      'marketplace_failed_oid',
      'marketplace_failed_parser_version',
    ]),
  )
  migrated.close()
})

it('permits multiple absent URLs, but enforces case-insensitive distinct populated URLs and preserves imported IDs', () => {
  const db = database()
  try {
    const insert = db.prepare('INSERT INTO repositories (id, html_url, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
    insert.run(27, null, 'original creation', 'original update')
    insert.run(99, null, 'later', 'later')
    insert.run(101, 'https://github.com/example/repo', 'later', 'later')
    expect(() => insert.run(105, 'https://github.com/example/repo', 'later', 'later')).toThrow(/UNIQUE/)
    expect(() => insert.run(106, 'https://github.com/EXAMPLE/REPO', 'later', 'later')).toThrow(/UNIQUE/)
    db.prepare("INSERT INTO repositories (html_url, createdAt, updatedAt) VALUES ('https://github.com/example/new', 'now', 'now')").run()
    expect(db.prepare('SELECT id, html_url FROM repositories ORDER BY id').all()).toEqual([
      { id: 27, html_url: null },
      { id: 99, html_url: null },
      { id: 101, html_url: 'https://github.com/example/repo' },
      { id: 102, html_url: 'https://github.com/example/new' },
    ])
  } finally {
    db.close()
  }
})

it('deduplicates case-variant repository URLs without mixing identity or reviving a stale description', () => {
  const db = database()
  const path = db.name
  db.exec(`
    DROP INDEX repositories_html_url_nocase_unique;
    ALTER TABLE repositories DROP COLUMN marketplace_failed_parser_version;
    ALTER TABLE repositories DROP COLUMN marketplace_failed_oid;
    ALTER TABLE repositories DROP COLUMN marketplace_parser_version;
    ALTER TABLE repositories DROP COLUMN marketplace_etag;
    ALTER TABLE repositories DROP COLUMN repository_etag;
    ALTER TABLE repositories DROP COLUMN marketplace_oid;
    ALTER TABLE repositories DROP COLUMN github_node_id;
    DROP TABLE discovery_ranges;
    ALTER TABLE run_errors DROP COLUMN query_family;
    PRAGMA user_version = 3;
  `)
  db.prepare(`
    INSERT INTO repositories (
      id, html_url, stargazers_count, forks_count, subscribers_count, description,
      owner, owner_url, repo_name, repo_updated, plugins_count, createdAt, updatedAt
    ) VALUES (
      700, 'https://github.com/Team/Repo', 5, 1, 1, 'stale description',
      'Team', 'https://github.com/Team', 'Repo', '2026-09-22T00:00:00Z', 1, 'old', 'old'
    )
  `).run()
  db.prepare(`
    INSERT INTO repositories (
      id, html_url, stargazers_count, forks_count, subscribers_count, description,
      owner, owner_url, repo_name, repo_updated, plugins_count, createdAt, updatedAt
    ) VALUES (
      701, 'https://github.com/team/repo', 10, 2, 1, NULL,
      'team', 'https://github.com/team', 'repo', '2026-09-23T00:00:00Z', 3, 'new', 'new'
    )
  `).run()
  db.prepare(
    "INSERT INTO runs (run_id, status, started_at, heartbeat_at, completed_at) VALUES ('migration-run', 'completed', 'start', 'beat', 'done')",
  ).run()
  db.prepare(`
    INSERT INTO run_errors (run_id, phase, repository_id, error_type, retry_count, occurred_at)
    VALUES ('migration-run', 'enrich', 701, 'temporary_error', 1, 'now')
  `).run()
  db.close()

  const migrated = openDatabase(path)
  expect(migrated.pragma('user_version', { simple: true })).toBe(12)
  expect(
    migrated
      .prepare(
        'SELECT id, html_url, stargazers_count, description, owner, owner_url, repo_name, repo_updated, plugins_count FROM repositories',
      )
      .all(),
  ).toEqual([
    {
      id: 700,
      html_url: 'https://github.com/team/repo',
      stargazers_count: 10,
      description: null,
      owner: 'team',
      owner_url: 'https://github.com/team',
      repo_name: 'repo',
      repo_updated: '2026-09-23T00:00:00Z',
      plugins_count: null,
    },
  ])
  expect(migrated.prepare("SELECT repository_id FROM run_errors WHERE run_id = 'migration-run'").get()).toEqual({
    repository_id: 700,
  })
  expect(() =>
    migrated
      .prepare("INSERT INTO repositories (html_url, createdAt, updatedAt) VALUES ('https://github.com/TEAM/REPO', 'later', 'later')")
      .run(),
  ).toThrow(/UNIQUE/)
  migrated.close()
})

it('invalidates cached marketplace counts when upgrading from v10', () => {
  const db = database()
  const path = db.name
  db.prepare(`
    INSERT INTO repositories (
      html_url, plugins_count, marketplace_oid, marketplace_etag, createdAt, updatedAt
    ) VALUES (
      'https://github.com/acme/catalog', 3, 'marketplace-oid', 'W/"marketplace"', 'before', 'before'
    )
  `).run()
  db.exec(`
    DROP TABLE discovery_ranges;
    CREATE TABLE discovery_ranges (
      root_start INTEGER NOT NULL CHECK(root_start >= 0),
      root_end INTEGER NOT NULL CHECK(root_end >= root_start),
      range_start INTEGER NOT NULL CHECK(range_start >= root_start),
      range_end INTEGER NOT NULL CHECK(range_end >= range_start AND range_end <= root_end),
      PRIMARY KEY (root_start, root_end, range_start, range_end)
    );
    ALTER TABLE run_errors DROP COLUMN query_family;
    PRAGMA user_version = 10;
  `)
  db.close()

  const migrated = openDatabase(path)
  expect(migrated.pragma('user_version', { simple: true })).toBe(12)
  expect(
    migrated
      .prepare('SELECT plugins_count, marketplace_oid, marketplace_etag FROM repositories WHERE html_url = ?')
      .get('https://github.com/acme/catalog'),
  ).toEqual({
    plugins_count: null,
    marketplace_oid: 'marketplace-oid',
    marketplace_etag: null,
  })
  migrated.close()
})

it.each([
  [
    'marketplace-retry branch',
    `
      ALTER TABLE runs DROP COLUMN phase_processed;
      ALTER TABLE runs DROP COLUMN phase_total;
      ALTER TABLE runs DROP COLUMN phase_started_at;
      ALTER TABLE runs DROP COLUMN phase;
    `,
  ],
  [
    'main branch',
    `
      ALTER TABLE repositories DROP COLUMN marketplace_failed_parser_version;
      ALTER TABLE repositories DROP COLUMN marketplace_failed_oid;
    `,
  ],
])('upgrades the v9 schema from the %s to v12', (_lineage, schemaChanges) => {
  const db = database()
  const path = db.name
  db.close()
  const legacy = new Database(path)
  legacy.exec(`
    ${schemaChanges}
    DROP TABLE discovery_ranges;
    CREATE TABLE discovery_ranges (
      root_start INTEGER NOT NULL CHECK(root_start >= 0),
      root_end INTEGER NOT NULL CHECK(root_end >= root_start),
      range_start INTEGER NOT NULL CHECK(range_start >= root_start),
      range_end INTEGER NOT NULL CHECK(range_end >= range_start AND range_end <= root_end),
      PRIMARY KEY (root_start, root_end, range_start, range_end)
    );
    ALTER TABLE run_errors DROP COLUMN query_family;
    PRAGMA user_version = 9;
  `)
  legacy.close()

  const migrated = openDatabase(path)
  expect(migrated.pragma('user_version', { simple: true })).toBe(12)
  const repositoryColumns = (migrated.pragma('table_info(repositories)') as Array<{ name: string }>).map((column) => column.name)
  expect(repositoryColumns).toEqual(expect.arrayContaining(['marketplace_failed_oid', 'marketplace_failed_parser_version']))
  const runColumns = (migrated.pragma('table_info(runs)') as Array<{ name: string }>).map((column) => column.name)
  expect(runColumns).toEqual(expect.arrayContaining(['phase', 'phase_started_at', 'phase_total', 'phase_processed']))
  migrated.close()
})

it('migrates v10 discovery ranges to the current family and leaves old errors unclassified', () => {
  const db = database()
  const path = db.name
  db.exec(`
    DROP TABLE discovery_ranges;
    CREATE TABLE discovery_ranges (
      root_start INTEGER NOT NULL CHECK(root_start >= 0),
      root_end INTEGER NOT NULL CHECK(root_end >= root_start),
      range_start INTEGER NOT NULL CHECK(range_start >= root_start),
      range_end INTEGER NOT NULL CHECK(range_end >= range_start AND range_end <= root_end),
      PRIMARY KEY (root_start, root_end, range_start, range_end)
    );
    ALTER TABLE run_errors DROP COLUMN query_family;
    PRAGMA user_version = 10;
    INSERT INTO discovery_ranges (root_start, root_end, range_start, range_end)
      VALUES (0, 3, 0, 1), (0, 3, 2, 3);
    INSERT INTO runs (run_id, status, started_at, heartbeat_at)
      VALUES ('old-search', 'completed', 'start', 'beat');
    INSERT INTO run_errors (run_id, phase, error_type, retry_count, occurred_at)
      VALUES ('old-search', 'search', 'temporary-error', 1, 'then');
  `)
  db.close()

  const migrated = openDatabase(path)
  try {
    expect(migrated.pragma('user_version', { simple: true })).toBe(12)
    expect(
      migrated
        .prepare('SELECT query_family, root_start, root_end, range_start, range_end FROM discovery_ranges ORDER BY range_start')
        .all(),
    ).toEqual([
      { query_family: 'marketplace_filename_path', root_start: 0, root_end: 3, range_start: 0, range_end: 1 },
      { query_family: 'marketplace_filename_path', root_start: 0, root_end: 3, range_start: 2, range_end: 3 },
    ])
    expect(migrated.prepare("SELECT query_family FROM run_errors WHERE run_id = 'old-search'").get()).toEqual({ query_family: null })
  } finally {
    migrated.close()
  }
})

it('preserves stats dates and IDs, and prevents duplicate dates or negative sizes', () => {
  const db = database()
  try {
    const insert = db.prepare('INSERT INTO stats (id, date, size, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)')
    insert.run(33, '2024-01-01T12:00:00+03:00', 20, 'original', 'updated')
    expect(() => insert.run(34, '2024-01-01T12:00:00+03:00', 21, 'original', 'updated')).toThrow(/UNIQUE/)
    expect(() => insert.run(35, '2024-01-02', -1, 'original', 'updated')).toThrow(/CHECK/)
    expect(db.prepare('SELECT id, date, size, createdAt, updatedAt, run_id FROM stats').get()).toEqual({
      id: 33,
      date: '2024-01-01T12:00:00+03:00',
      size: 20,
      createdAt: 'original',
      updatedAt: 'updated',
      run_id: null,
    })
  } finally {
    db.close()
  }
})

it('configures SQLite durability and enforces foreign keys', () => {
  const db = database()
  try {
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.pragma('busy_timeout', { simple: true })).toBeGreaterThanOrEqual(5000)
    expect(() =>
      db
        .prepare(
          "INSERT INTO run_errors (run_id, phase, error_type, retry_count, occurred_at) VALUES ('missing', 'search', 'quota', 0, 'now')",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/)
  } finally {
    db.close()
  }
})
