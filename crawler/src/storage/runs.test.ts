import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, expect, it } from 'vitest'
import { openDatabase } from './db.js'
import * as runStorage from './runs.js'

const databases: Database.Database[] = []
const directories: string[] = []

function database() {
  const directory = mkdtempSync(join(import.meta.dirname, '.runs-'))
  directories.push(directory)
  const db = openDatabase(join(directory, 'catalog.sqlite'))
  databases.push(db)
  return db
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

it('allows one running crawl at a time, tracks heartbeat and completion, then releases the lock', () => {
  const { beginRun, heartbeatRun, completeRun, getRun } = runStorage
  const db = database()
  beginRun(db, 'run-1', '2025-01-01T00:00:00Z')
  expect(() => beginRun(db, 'run-2', '2025-01-01T00:01:00Z')).toThrow(/running|UNIQUE/)
  expect(heartbeatRun(db, 'run-1', '2025-01-01T00:02:00Z')).toBe(true)
  expect(completeRun(db, 'run-1', '2025-01-01T00:03:00Z', 2)).toBe(true)
  expect(heartbeatRun(db, 'run-1', '2025-01-01T00:04:00Z')).toBe(false)
  beginRun(db, 'run-2', '2025-01-01T00:04:00Z')
  expect(getRun(db, 'run-1')).toMatchObject({
    run_id: 'run-1',
    status: 'completed',
    started_at: '2025-01-01T00:00:00Z',
    heartbeat_at: '2025-01-01T00:02:00Z',
    completed_at: '2025-01-01T00:03:00Z',
    warning_count: 2,
    published_at: null,
  })
  expect(getRun(db, 'run-2')?.status).toBe('running')
})

it('exposes the active run for stale-heartbeat recovery after a process restart', () => {
  const { beginRun, getActiveRun, failRun } = runStorage
  const db = database()
  expect(getActiveRun(db)).toBeNull()
  beginRun(db, 'stale-run', '2025-01-01T00:00:00Z')
  expect(getActiveRun(db)).toMatchObject({ run_id: 'stale-run', heartbeat_at: '2025-01-01T00:00:00Z' })
  failRun(db, 'stale-run', '2025-01-02T00:00:00Z', 'stale-heartbeat')
  expect(getActiveRun(db)).toBeNull()
})

it('persists structured errors without storing tokens or HTTP response bodies', () => {
  const { beginRun, recordRunError, listRunErrors, failRun, getRun } = runStorage
  const db = database()
  beginRun(db, 'run-1', '2025-01-01T00:00:00Z')
  recordRunError(db, {
    run_id: 'run-1',
    phase: 'search',
    range_start: 1,
    range_end: 150,
    error_type: 'rate-limited',
    retry_count: 2,
    occurred_at: '2025-01-01T00:01:00Z',
  })
  recordRunError(db, {
    run_id: 'run-1',
    phase: 'enrich',
    repository_id: 45,
    error_type: 'manifest-invalid',
    retry_count: 0,
    occurred_at: '2025-01-01T00:02:00Z',
  })
  expect(() =>
    recordRunError(db, {
      run_id: 'run-1',
      phase: 'search',
      error_type: 'Authorization: Bearer ghp-secret',
      retry_count: 0,
      occurred_at: 'now',
    }),
  ).toThrow(/error_type/)
  expect(listRunErrors(db, 'run-1')).toMatchObject([
    { phase: 'search', range_start: 1, range_end: 150, repository_id: null, error_type: 'rate-limited', retry_count: 2 },
    { phase: 'enrich', range_start: null, range_end: null, repository_id: 45, error_type: 'manifest-invalid', retry_count: 0 },
  ])
  expect(failRun(db, 'run-1', '2025-01-01T00:03:00Z', 'quota-exhausted')).toBe(true)
  expect(getRun(db, 'run-1')).toMatchObject({ status: 'failed', last_error: 'quota-exhausted' })
  expect(() => failRun(db, 'run-1', 'later', 'Authorization: Bearer ghp-secret')).toThrow(/last_error/)
  expect(getRun(db, 'run-1')?.last_error).toBe('quota-exhausted')
  expect(listRunErrors(db, 'run-1')).toHaveLength(2)
})

it('records a pending Git commit and reconciles publication once per run', () => {
  const { beginRun, completeRun, setPendingCommit, markPublished, getRun, getSetting } = runStorage
  const db = database()
  const sha = 'a'.repeat(40)
  beginRun(db, 'run-1', '2025-01-01T00:00:00Z')
  completeRun(db, 'run-1', '2025-01-01T02:00:00Z', 0)
  runStorage.saveRunDraft(db, 'run-1', { id: 1, date: '2025-01-01T02:01:00.000Z', size: 42, hash: 'd'.repeat(64) })
  expect(setPendingCommit(db, 'run-1', sha)).toBe(true)
  expect(getRun(db, 'run-1')?.pending_commit_sha).toBe(sha)
  const publication = {
    date: '2025-01-01T02:01:00.000Z',
    size: 42,
    publishedAt: '2025-01-01T02:02:00Z',
    commitSha: sha,
  }
  expect(markPublished(db, 'run-1', publication)).toBe(true)
  expect(markPublished(db, 'run-1', publication)).toBe(false)
  expect(db.prepare('SELECT date, size, run_id FROM stats').all()).toEqual([
    { date: '2025-01-01T02:01:00.000Z', size: 42, run_id: 'run-1' },
  ])
  expect(getRun(db, 'run-1')).toMatchObject({
    status: 'published',
    commit_sha: sha,
    published_at: '2025-01-01T02:02:00Z',
    pending_commit_sha: null,
  })
  expect(getSetting(db, 'last_published_run_id')).toBe('run-1')
  expect(getSetting(db, 'last_published_at')).toBe('2025-01-01T02:02:00Z')
})

it('refuses an unverified SHA or duplicate stats date without partially publishing', () => {
  const { beginRun, completeRun, setPendingCommit, markPublished, getRun } = runStorage
  const db = database()
  const sha = 'b'.repeat(40)
  beginRun(db, 'run-1', '2025-01-01T00:00:00Z')
  completeRun(db, 'run-1', '2025-01-01T01:00:00Z', 0)
  runStorage.saveRunDraft(db, 'run-1', { id: 1, date: '2025-01-01T01:00:00.000Z', size: 2, hash: 'd'.repeat(64) })
  setPendingCommit(db, 'run-1', sha)
  expect(() =>
    markPublished(db, 'run-1', { date: '2025-01-01T01:00:00.000Z', size: 2, publishedAt: '2025-01-01', commitSha: 'c'.repeat(40) }),
  ).toThrow(/commit/)
  db.prepare("INSERT INTO stats (date, size, createdAt, updatedAt) VALUES ('2025-01-01T01:00:00.000Z', 1, 'old', 'old')").run()
  expect(() =>
    markPublished(db, 'run-1', { date: '2025-01-01T01:00:00.000Z', size: 2, publishedAt: '2025-01-01', commitSha: sha }),
  ).toThrow(/UNIQUE/)
  expect(getRun(db, 'run-1')).toMatchObject({ status: 'completed', commit_sha: null, pending_commit_sha: sha })
  expect(db.prepare('SELECT COUNT(*) AS count FROM stats').get()).toEqual({ count: 1 })
})

it('replaces an unpublished candidate SHA after a Git ref conflict', () => {
  const { beginRun, completeRun, setPendingCommit, markPublished, getRun } = runStorage
  const db = database()
  beginRun(db, 'run-conflict', '2025-01-01T00:00:00Z')
  completeRun(db, 'run-conflict', '2025-01-01T01:00:00Z', 0)
  runStorage.saveRunDraft(db, 'run-conflict', { id: 1, date: '2025-01-01T01:00:00.000Z', size: 1, hash: 'd'.repeat(64) })
  expect(setPendingCommit(db, 'run-conflict', 'a'.repeat(40))).toBe(true)
  expect(setPendingCommit(db, 'run-conflict', 'b'.repeat(40), 'a'.repeat(40))).toBe(true)
  expect(getRun(db, 'run-conflict')?.pending_commit_sha).toBe('b'.repeat(40))
  expect(
    markPublished(db, 'run-conflict', {
      date: '2025-01-01T01:00:00.000Z',
      size: 1,
      publishedAt: '2025-01-01T01:01:00Z',
      commitSha: 'b'.repeat(40),
    }),
  ).toBe(true)
})

it('stores import metadata and published timestamps in settings', () => {
  const { getSetting, setSetting } = runStorage
  const db = database()
  expect(getSetting(db, 'seed_hash')).toBeNull()
  setSetting(db, 'seed_hash', 'first-hash')
  setSetting(db, 'seed_hash', 'new-hash')
  expect(getSetting(db, 'seed_hash')).toBe('new-hash')
})

it('persists a typed draft only on a completed run and does not replace it', () => {
  const db = database()
  runStorage.beginRun(db, 'draft-run', '2025-01-01T00:00:00Z')
  const draft = { id: 265, date: '2025-01-02T00:00:00.000Z', size: 42, hash: 'a'.repeat(64) }
  expect(() => runStorage.saveRunDraft(db, 'draft-run', draft)).toThrow(/completed/)
  runStorage.completeRun(db, 'draft-run', '2025-01-01T01:00:00Z', 0)
  expect(runStorage.saveRunDraft(db, 'draft-run', draft)).toBe(true)
  expect(runStorage.saveRunDraft(db, 'draft-run', draft)).toBe(false)
  expect(() => runStorage.saveRunDraft(db, 'draft-run', { ...draft, hash: 'b'.repeat(64) })).toThrow(/draft/)
  expect(runStorage.getRun(db, 'draft-run')).toMatchObject({
    draft_id: 265,
    draft_date: draft.date,
    draft_size: 42,
    draft_hash: draft.hash,
  })
  expect(db.prepare('SELECT COUNT(*) AS count FROM stats').get()).toEqual({ count: 0 })
})

it('refuses to overwrite an unverified pending SHA and inserts the exact drafted stats ID', () => {
  const db = database()
  runStorage.beginRun(db, 'safe', '2025-01-01T00:00:00Z')
  runStorage.completeRun(db, 'safe', '2025-01-01T01:00:00Z', 0)
  const draft = { id: 999, date: '2025-01-01T01:00:00.000Z', size: 2, hash: 'e'.repeat(64) }
  runStorage.saveRunDraft(db, 'safe', draft)
  expect(runStorage.setPendingCommit(db, 'safe', 'a'.repeat(40))).toBe(true)
  expect(() => runStorage.setPendingCommit(db, 'safe', 'b'.repeat(40))).toThrow(/Pending/)
  expect(runStorage.getRun(db, 'safe')?.pending_commit_sha).toBe('a'.repeat(40))
  expect(() =>
    runStorage.markPublished(db, 'safe', {
      date: draft.date,
      size: 3,
      publishedAt: draft.date,
      commitSha: 'a'.repeat(40),
    }),
  ).toThrow(/draft/)
  expect(db.prepare('SELECT COUNT(*) AS count FROM stats').get()).toEqual({ count: 0 })
  expect(
    runStorage.markPublished(db, 'safe', {
      date: draft.date,
      size: draft.size,
      publishedAt: draft.date,
      commitSha: 'a'.repeat(40),
    }),
  ).toBe(true)
  expect(db.prepare('SELECT id, run_id FROM stats').all()).toEqual([{ id: 999, run_id: 'safe' }])
})

it('does not allow a Git candidate to be attached to a run without a prepared draft', () => {
  const db = database()
  runStorage.beginRun(db, 'not-ready', '2025-01-01T00:00:00Z')
  runStorage.completeRun(db, 'not-ready', '2025-01-01T01:00:00Z', 0)
  expect(() => runStorage.setPendingCommit(db, 'not-ready', 'a'.repeat(40))).toThrow(/draft/)
})
