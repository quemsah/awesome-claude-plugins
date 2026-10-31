import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, expect, it } from 'vitest'
import { openDatabase } from './db.js'
import { runMaintenance } from './maintenance.js'

const databases: Database.Database[] = []
const directories: string[] = []

function database() {
  const directory = mkdtempSync(join(import.meta.dirname, '.maintenance-'))
  directories.push(directory)
  const db = openDatabase(join(directory, 'catalog.sqlite'))
  databases.push(db)
  return db
}

function insertRun(db: Database.Database, runId: string, status: 'completed' | 'failed' | 'published', completedAt: string): void {
  db.prepare(`
    INSERT INTO runs (run_id, status, started_at, heartbeat_at, completed_at, published_at, commit_sha)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    runId,
    status,
    completedAt,
    completedAt,
    completedAt,
    status === 'published' ? completedAt : null,
    status === 'published' ? 'a'.repeat(40) : null,
  )
}

afterEach(() => {
  for (const db of databases.splice(0)) {
    if (db.open) db.close()
  }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

it('prunes old run diagnostics while preserving stats, recent runs and publication leases', () => {
  const db = database()
  const old = '2026-01-01T00:00:00.000Z'
  const recent = '2026-09-01T00:00:00.000Z'

  insertRun(db, 'old-published', 'published', old)
  insertRun(db, 'old-failed', 'failed', old)
  insertRun(db, 'leased', 'completed', old)
  insertRun(db, 'recent', 'failed', recent)

  db.prepare(`
    INSERT INTO stats (date, size, createdAt, updatedAt, run_id)
    VALUES ('2026-01-01T01:00:00.000Z', 42, ?, ?, 'old-published')
  `).run(old, old)
  db.prepare("INSERT INTO publication_lease (slot, run_id, owner) VALUES (1, 'leased', 'publisher')").run()

  const error = db.prepare(`
    INSERT INTO run_errors (run_id, phase, error_type, retry_count, occurred_at)
    VALUES (?, 'crawl', 'test_error', 0, ?)
  `)
  for (const runId of ['old-published', 'old-failed', 'leased', 'recent']) error.run(runId, old)

  const setting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
  for (const runId of ['old-published', 'old-failed', 'leased', 'recent']) {
    setting.run(`run_report_${runId}`, '{}')
    setting.run(`run_rate_metrics_${runId}`, '{}')
    setting.run(`schedule_alert_active_run_${runId}`, 'sent')
  }
  setting.run('last_published_at', old)

  const result = runMaintenance(db, new Date('2026-09-24T00:00:00.000Z'))

  expect(result).toMatchObject({
    cutoff: '2026-06-26T00:00:00.000Z',
    retentionDays: 90,
    runsDeleted: 2,
    errorsDeleted: 2,
    settingsDeleted: 6,
    statsDetached: 1,
    walCheckpoint: {
      busy: expect.any(Number),
      log: expect.any(Number),
      checkpointed: expect.any(Number),
    },
  })
  expect(db.prepare('SELECT run_id, status FROM runs ORDER BY run_id').all()).toEqual([
    { run_id: 'leased', status: 'completed' },
    { run_id: 'recent', status: 'failed' },
  ])
  expect(db.prepare('SELECT date, size, run_id FROM stats').get()).toEqual({
    date: '2026-01-01T01:00:00.000Z',
    size: 42,
    run_id: null,
  })
  expect(db.prepare('SELECT run_id FROM run_errors ORDER BY run_id').all()).toEqual([{ run_id: 'leased' }, { run_id: 'recent' }])
  expect(db.prepare("SELECT key FROM settings WHERE key LIKE 'run_report_%' ORDER BY key").all()).toEqual([
    { key: 'run_report_leased' },
    { key: 'run_report_recent' },
  ])
  expect(db.prepare("SELECT key FROM settings WHERE key LIKE 'run_rate_metrics_%' ORDER BY key").all()).toEqual([
    { key: 'run_rate_metrics_leased' },
    { key: 'run_rate_metrics_recent' },
  ])
  expect(db.prepare("SELECT key FROM settings WHERE key LIKE 'schedule_alert_%' ORDER BY key").all()).toEqual([
    { key: 'schedule_alert_active_run_leased' },
    { key: 'schedule_alert_active_run_recent' },
  ])
  expect(db.prepare("SELECT value FROM settings WHERE key = 'last_published_at'").get()).toEqual({ value: old })
  expect(db.pragma('foreign_key_check')).toEqual([])
})

it('keeps alert settings for a different run whose id only shares the deleted suffix', () => {
  const db = database()
  const old = '2026-01-01T00:00:00.000Z'
  const recent = '2026-09-01T00:00:00.000Z'

  insertRun(db, 'old', 'failed', old)
  insertRun(db, 'recent_old', 'failed', recent)

  const setting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
  setting.run('run_report_old', '{}')
  setting.run('schedule_alert_active_run_old', 'sent')
  setting.run('schedule_alert_publication_locked_old', 'sent')
  setting.run('schedule_alert_active_run_recent_old', 'sent')
  setting.run('schedule_alert_publication_locked_recent_old', 'sent')

  const result = runMaintenance(db, new Date('2026-09-24T00:00:00.000Z'))

  expect(result).toMatchObject({ runsDeleted: 1, settingsDeleted: 3 })
  expect(db.prepare("SELECT key FROM settings WHERE key LIKE 'schedule_alert_%' ORDER BY key").all()).toEqual([
    { key: 'schedule_alert_active_run_recent_old' },
    { key: 'schedule_alert_publication_locked_recent_old' },
  ])
})

it('prunes discovery provenance with expired runs while retaining recent, boundary and leased attribution', () => {
  const db = database()
  insertRun(db, 'expired', 'completed', '2026-01-01T00:00:00.000Z')
  insertRun(db, 'recent', 'failed', '2026-09-01T00:00:00.000Z')
  insertRun(db, 'boundary', 'completed', '2026-06-26T00:00:00.000Z')
  insertRun(db, 'leased', 'completed', '2026-01-01T00:00:00.000Z')
  db.prepare("INSERT INTO publication_lease (slot, run_id, owner) VALUES (1, 'leased', 'publisher')").run()
  const candidate = db.prepare(`
    INSERT INTO discovery_candidates (run_id, repository_id, source, query_id) VALUES (?, 123, ?, ?)
  `)
  for (const run of ['expired', 'recent', 'boundary', 'leased']) {
    candidate.run(run, 'code_search', 'marketplace_filename_path')
    candidate.run(run, 'repo_search', 'readme_plugin')
  }

  expect(runMaintenance(db, new Date('2026-09-24T00:00:00.000Z'))).toMatchObject({ runsDeleted: 1 })
  expect(db.prepare('SELECT run_id, COUNT(*) AS count FROM discovery_candidates GROUP BY run_id ORDER BY run_id').all()).toEqual([
    { run_id: 'boundary', count: 2 },
    { run_id: 'leased', count: 2 },
    { run_id: 'recent', count: 2 },
  ])
  expect(db.pragma('foreign_key_check')).toEqual([])
})

it('rejects invalid maintenance inputs without deleting data', () => {
  const db = database()
  insertRun(db, 'old', 'failed', '2026-01-01T00:00:00.000Z')

  expect(() => runMaintenance(db, new Date('invalid'))).toThrow(/valid date/)
  expect(() => runMaintenance(db, new Date('2026-09-24T00:00:00.000Z'), 0)).toThrow(/positive integer/)
  expect(db.prepare('SELECT run_id FROM runs').all()).toEqual([{ run_id: 'old' }])
})
