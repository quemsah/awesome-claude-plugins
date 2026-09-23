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
    { name: 'publication_lease' },
    { name: 'repositories' },
    { name: 'run_errors' },
    { name: 'runs' },
    { name: 'settings' },
    { name: 'stats' },
  ])
  expect(db.pragma('user_version', { simple: true })).toBe(3)
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
      INSERT INTO repositories VALUES (53000, NULL, 'before', 'after');
      INSERT INTO runs VALUES ('old', 'completed', 'start', 'beat', 'done', NULL, NULL, NULL, 3, NULL);
      INSERT INTO stats VALUES (264, '2024-01-01', 42, 'before', 'after', NULL);
      PRAGMA user_version = 1;
    `)
    initializeSchema(db)
    initializeSchema(db)
    expect(db.pragma('user_version', { simple: true })).toBe(3)
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
  old.exec('DROP TABLE publication_lease; PRAGMA user_version = 2;')
  old.close()
  const migrated = openDatabase(path)
  expect(migrated.pragma('user_version', { simple: true })).toBe(3)
  expect(migrated.prepare("SELECT draft_hash, pending_commit_sha FROM runs WHERE run_id = 'pending'").get()).toEqual({
    draft_hash: 'a'.repeat(64),
    pending_commit_sha: 'b'.repeat(40),
  })
  expect(migrated.prepare('SELECT run_id FROM publication_lease').get()).toEqual({ run_id: 'pending' })
  migrated.close()
})

it('permits multiple absent URLs, but enforces distinct populated URLs and preserves imported IDs', () => {
  const db = database()
  try {
    const insert = db.prepare('INSERT INTO repositories (id, html_url, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
    insert.run(27, null, 'original creation', 'original update')
    insert.run(99, null, 'later', 'later')
    insert.run(101, 'https://github.com/example/repo', 'later', 'later')
    expect(() => insert.run(105, 'https://github.com/example/repo', 'later', 'later')).toThrow(/UNIQUE/)
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
