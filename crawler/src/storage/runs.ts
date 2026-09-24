import type Database from 'better-sqlite3'
import { assertValidStatsDraft, type StatsRecord } from '../output/statsDraft.js'

export type RunStatus = 'running' | 'completed' | 'failed' | 'published'

export interface RunRow {
  run_id: string
  status: RunStatus
  started_at: string
  heartbeat_at: string
  completed_at: string | null
  published_at: string | null
  commit_sha: string | null
  pending_commit_sha: string | null
  draft_date: string | null
  draft_id: number | null
  draft_size: number | null
  draft_hash: string | null
  warning_count: number
  last_error: string | null
}

export type RunErrorPhase = 'search' | 'enrich' | 'publish' | 'notify' | 'crawl'

export interface RunErrorInput {
  run_id: string
  phase: RunErrorPhase
  repository_id?: number | null
  range_start?: number | null
  range_end?: number | null
  error_type: string
  retry_count: number
  occurred_at: string
}

export interface RunErrorRow extends Required<RunErrorInput> {
  id: number
}

export interface Publication {
  date: string
  size: number
  publishedAt: string
  commitSha: string
}

export interface RunDraft extends StatsRecord {
  hash: string
}

export class PublicationLeaseError extends Error {
  constructor(readonly category: 'active_run' | 'publication_locked') {
    super(`Publication refused: ${category}`)
    this.name = 'PublicationLeaseError'
  }
}

export class RunNotActiveError extends Error {
  constructor(readonly runId: string) {
    super('Run is no longer active')
    this.name = 'RunNotActiveError'
  }
}

export function getPublicationLease(db: Database.Database): { run_id: string; owner: string } | null {
  return (
    (db.prepare('SELECT run_id, owner FROM publication_lease WHERE slot = 1').get() as { run_id: string; owner: string } | undefined) ??
    null
  )
}

export function claimPublicationLease(db: Database.Database, runId: string, owner: string, recover = false): void {
  db.transaction(() => {
    if (getActiveRun(db)) throw new PublicationLeaseError('active_run')
    const run = getRun(db, runId)
    if (run?.status !== 'completed' || run.draft_hash === null) throw new Error('Run has no completed draft')
    const existing = getPublicationLease(db)
    if (existing) {
      if (existing.run_id !== runId || !recover) throw new PublicationLeaseError('publication_locked')
      db.prepare('UPDATE publication_lease SET owner = ? WHERE slot = 1').run(owner)
    } else {
      db.prepare('INSERT INTO publication_lease (slot, run_id, owner) VALUES (1, ?, ?)').run(runId, owner)
    }
  })()
}

export function releasePublicationLease(db: Database.Database, runId: string, owner: string): void {
  const result = db.prepare('DELETE FROM publication_lease WHERE slot = 1 AND run_id = ? AND owner = ?').run(runId, owner)
  if (result.changes !== 1) throw new PublicationLeaseError('publication_locked')
}

function assertCategory(value: string, name: string): void {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(value)) throw new Error(`${name} must be a short error category, never a message`)
}

function assertSha(sha: string): void {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('commit SHA must be a 40-character lowercase hex string')
}

export function beginRun(db: Database.Database, runId: string, startedAt: string): void {
  db.transaction(() => {
    if (getPublicationLease(db)) throw new PublicationLeaseError('publication_locked')
    db.prepare("INSERT INTO runs (run_id, status, started_at, heartbeat_at) VALUES (?, 'running', ?, ?)").run(runId, startedAt, startedAt)
  })()
}

export function getRun(db: Database.Database, runId: string): RunRow | null {
  return (db.prepare('SELECT * FROM runs WHERE run_id = ?').get(runId) as RunRow | undefined) ?? null
}

export function getActiveRun(db: Database.Database): RunRow | null {
  return (db.prepare("SELECT * FROM runs WHERE status = 'running'").get() as RunRow | undefined) ?? null
}

export function heartbeatRun(db: Database.Database, runId: string, at: string): boolean {
  return db.prepare("UPDATE runs SET heartbeat_at = ? WHERE run_id = ? AND status = 'running'").run(at, runId).changes !== 0
}

export function runWhileActive<T>(db: Database.Database, runId: string, operation: () => T): T {
  return db
    .transaction(() => {
      const active = db.prepare("SELECT 1 FROM runs WHERE run_id = ? AND status = 'running'").get(runId)
      if (!active) throw new RunNotActiveError(runId)
      return operation()
    })
    .immediate()
}

export function completeRun(db: Database.Database, runId: string, at: string, warningCount: number): boolean {
  if (!Number.isSafeInteger(warningCount) || warningCount < 0) throw new Error('warningCount must be nonnegative')
  return (
    db
      .prepare("UPDATE runs SET status = 'completed', completed_at = ?, warning_count = ? WHERE run_id = ? AND status = 'running'")
      .run(at, warningCount, runId).changes !== 0
  )
}

export function failRun(db: Database.Database, runId: string, at: string, lastError: string): boolean {
  assertCategory(lastError, 'last_error')
  return (
    db
      .prepare("UPDATE runs SET status = 'failed', completed_at = ?, last_error = ? WHERE run_id = ? AND status = 'running'")
      .run(at, lastError, runId).changes !== 0
  )
}

export function terminateRun(db: Database.Database, runId: string, at: string): boolean {
  return failRun(db, runId, at, 'terminated')
}

export function recoverStaleRun(db: Database.Database, cutoffAt: string, recoveredAt: string): RunRow | null {
  const cutoff = Date.parse(cutoffAt)
  if (!Number.isFinite(cutoff)) throw new Error('Stale-run cutoff must be a valid date')

  return db
    .transaction(() => {
      if (getPublicationLease(db)) return null
      const active = getActiveRun(db)
      if (!active) return null
      const heartbeat = Date.parse(active.heartbeat_at)
      if (!Number.isFinite(heartbeat) || heartbeat >= cutoff) return null

      recordRunError(db, {
        run_id: active.run_id,
        phase: 'crawl',
        error_type: 'stale_run',
        retry_count: 0,
        occurred_at: recoveredAt,
      })
      if (!failRun(db, active.run_id, recoveredAt, 'stale_run')) return null
      return active
    })
    .immediate()
}

export function recoverStoppedCrawl(db: Database.Database, runId: string, at: string): void {
  db.transaction(() => {
    if (getPublicationLease(db)) throw new PublicationLeaseError('publication_locked')
    if (getRun(db, runId)?.status !== 'running') throw new Error('Recovery requires a running crawl')
    recordRunError(db, { run_id: runId, phase: 'crawl', error_type: 'operator_recovery', retry_count: 0, occurred_at: at })
    if (!failRun(db, runId, at, 'operator_recovery')) throw new Error('Recovery requires a running crawl')
  })()
}

export function recordRunError(db: Database.Database, error: RunErrorInput): void {
  assertCategory(error.error_type, 'error_type')
  if (!['search', 'enrich', 'publish', 'notify', 'crawl'].includes(error.phase)) throw new Error('Invalid error phase')
  if (!Number.isSafeInteger(error.retry_count) || error.retry_count < 0) throw new Error('retry_count must be nonnegative')
  db.prepare(`
    INSERT INTO run_errors (run_id, phase, repository_id, range_start, range_end, error_type, retry_count, occurred_at)
    VALUES (@run_id, @phase, @repository_id, @range_start, @range_end, @error_type, @retry_count, @occurred_at)
  `).run({
    ...error,
    repository_id: error.repository_id ?? null,
    range_start: error.range_start ?? null,
    range_end: error.range_end ?? null,
  })
}

export function listRunErrors(db: Database.Database, runId: string): RunErrorRow[] {
  return db.prepare('SELECT * FROM run_errors WHERE run_id = ? ORDER BY id').all(runId) as RunErrorRow[]
}

export function getSetting(db: Database.Database, key: string): string | null {
  return (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null
}

export function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

export function setPendingCommit(db: Database.Database, runId: string, sha: string, previousSha: string | null = null): boolean {
  assertSha(sha)
  const run = getRun(db, runId)
  if (run?.status !== 'completed') return false
  if (run.draft_hash === null) throw new Error('Run has no prepared draft')
  if (run.pending_commit_sha !== previousSha) throw new Error('Pending commit changed before Git confirmation')
  return (
    db
      .prepare("UPDATE runs SET pending_commit_sha = ? WHERE run_id = ? AND status = 'completed' AND pending_commit_sha IS ?")
      .run(sha, runId, previousSha).changes === 1
  )
}

export function clearPendingCommit(db: Database.Database, runId: string, sha: string): boolean {
  assertSha(sha)
  return (
    db
      .prepare("UPDATE runs SET pending_commit_sha = NULL WHERE run_id = ? AND status = 'completed' AND pending_commit_sha = ?")
      .run(runId, sha).changes === 1
  )
}

export function saveRunDraft(db: Database.Database, runId: string, draft: RunDraft): boolean {
  assertValidStatsDraft(draft)
  if (!/^[a-f0-9]{64}$/.test(draft.hash)) throw new Error('Draft hash must be a SHA-256 digest')
  const run = getRun(db, runId)
  if (run?.status !== 'completed') throw new Error('Draft requires a completed run')
  if (run.draft_date !== null || run.draft_id !== null || run.draft_size !== null || run.draft_hash !== null) {
    if (run.draft_date !== draft.date || run.draft_id !== draft.id || run.draft_size !== draft.size || run.draft_hash !== draft.hash)
      throw new Error('Existing run draft differs')
    return false
  }
  if (run.pending_commit_sha !== null) throw new Error('Cannot prepare draft after a pending commit')
  const result = db
    .prepare(`
    UPDATE runs SET draft_date = ?, draft_id = ?, draft_size = ?, draft_hash = ?
    WHERE run_id = ? AND status = 'completed' AND draft_hash IS NULL
  `)
    .run(draft.date, draft.id, draft.size, draft.hash, runId)
  if (result.changes !== 1) throw new Error('Run draft changed concurrently')
  return true
}

export function markPublished(db: Database.Database, runId: string, publication: Publication, owner?: string): boolean {
  assertSha(publication.commitSha)
  if (!Number.isSafeInteger(publication.size) || publication.size < 0) throw new Error('Publication size must be nonnegative')
  return db.transaction(() => {
    const run = getRun(db, runId)
    if (run?.status === 'published') {
      const stat = db.prepare('SELECT date, size FROM stats WHERE run_id = ?').get(runId) as { date: string; size: number } | undefined
      if (
        run.commit_sha !== publication.commitSha ||
        run.published_at !== publication.publishedAt ||
        stat?.date !== publication.date ||
        stat.size !== publication.size
      ) {
        throw new Error('Published run has a different commit or stats')
      }
      return false
    }
    if (run?.status !== 'completed' || run.pending_commit_sha !== publication.commitSha) {
      throw new Error('Run has no matching pending commit')
    }
    if (run.draft_id === null || run.draft_date !== publication.date || run.draft_size !== publication.size || run.draft_hash === null) {
      throw new Error('Publication differs from the prepared draft')
    }

    db.prepare('INSERT INTO stats (id, date, size, createdAt, updatedAt, run_id) VALUES (?, ?, ?, ?, ?, ?)').run(
      run.draft_id,
      publication.date,
      publication.size,
      publication.publishedAt,
      publication.publishedAt,
      runId,
    )
    db.prepare(`
      UPDATE runs SET status = 'published', published_at = ?, commit_sha = ?, pending_commit_sha = NULL
      WHERE run_id = ?
    `).run(publication.publishedAt, publication.commitSha, runId)
    setSetting(db, 'last_published_run_id', runId)
    setSetting(db, 'last_published_at', publication.publishedAt)
    if (owner) releasePublicationLease(db, runId, owner)
    return true
  })()
}
