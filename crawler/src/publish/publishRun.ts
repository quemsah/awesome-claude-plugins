import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { renderRepos, renderStats } from '../output/catalogSnapshot.js'
import { renderReadme } from '../output/readme.js'
import { assertValidStatsDraft, createStatsDraft, type StatsRecord } from '../output/statsDraft.js'
import { SnapshotValidationError, validateSnapshot } from '../output/validate.js'
import { validateReadme } from '../output/validateReadme.js'
import { listPublishable } from '../storage/repositories.js'
import {
  claimPublicationLease,
  getRun,
  markPublished,
  PublicationLeaseError,
  type RunDraft,
  type RunRow,
  releasePublicationLease,
  saveRunDraft,
  setPendingCommit,
} from '../storage/runs.js'
import { type GitHubGit, GitHubGitConflictError, type GitSnapshotFiles } from './githubGit.js'

export type PublicationCategory =
  | 'invalid_run'
  | 'draft_missing'
  | 'draft_invalid'
  | 'snapshot_invalid'
  | 'snapshot_changed'
  | 'historical_conflict'
  | 'write_disabled'
  | 'git_error'
  | 'git_indeterminate'
  | 'git_conflict'
  | 'database_error'
  | 'active_run'
  | 'publication_locked'

export class PublicationError extends Error {
  constructor(
    readonly category: PublicationCategory,
    readonly validation?: { count: number; paths: readonly string[] },
  ) {
    super(`Publication refused: ${category}`)
    this.name = 'PublicationError'
  }
}

function databaseResult<T>(operation: () => T): T {
  try {
    return operation()
  } catch (error) {
    if (error instanceof PublicationError) throw error
    throw new PublicationError('database_error')
  }
}

function historicalStats(db: Database.Database): StatsRecord[] {
  return db.prepare('SELECT id, date, size FROM stats ORDER BY id').all() as StatsRecord[]
}

function checkHistory(history: readonly StatsRecord[], draft: StatsRecord): void {
  if (history.some((entry) => entry.id >= draft.id || entry.date === draft.date)) {
    throw new PublicationError('historical_conflict')
  }
}

function savedDraft(run: RunRow): RunDraft {
  const { draft_id: id, draft_date: date, draft_size: size, draft_hash: hash } = run
  if (id === null || date === null || size === null || hash === null) throw new PublicationError('draft_missing')
  const draft = { id, date, size, hash }
  try {
    assertValidStatsDraft(draft)
  } catch {
    throw new PublicationError('draft_invalid')
  }
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new PublicationError('draft_invalid')
  return draft
}

function publishedCommit(db: Database.Database, runId: string): string {
  return databaseResult(() =>
    db.transaction(() => {
      const run = getRun(db, runId)
      if (run?.status !== 'published' || !run.commit_sha || !/^[a-f0-9]{40}$/.test(run.commit_sha) || run.pending_commit_sha !== null) {
        throw new PublicationError('invalid_run')
      }
      if (
        !run.published_at ||
        Number.isNaN(Date.parse(run.published_at)) ||
        new Date(run.published_at).toISOString() !== run.published_at
      ) {
        throw new PublicationError('invalid_run')
      }
      let draft: RunDraft
      try {
        draft = savedDraft(run)
      } catch {
        throw new PublicationError('invalid_run')
      }
      const stat = db.prepare('SELECT id, date, size FROM stats WHERE run_id = ?').get(runId) as StatsRecord | undefined
      if (!stat || stat.id !== draft.id || stat.date !== draft.date || stat.size !== draft.size) {
        throw new PublicationError('invalid_run')
      }
      return run.commit_sha
    })(),
  )
}

function renderFiles(db: Database.Database, draft: StatsRecord): { files: GitSnapshotFiles; hash: string } {
  checkHistory(historicalStats(db), draft)
  let files: GitSnapshotFiles
  try {
    const publicDraft = { id: draft.id, date: draft.date, size: draft.size }
    const repositories = listPublishable(db)
    files = {
      readme: renderReadme(repositories, draft),
      reposJson: renderRepos(db),
      statsJson: renderStats(db, publicDraft),
    }
    validateSnapshot(files.reposJson, files.statsJson, { expectedSize: draft.size, requireLatestSize: true })
    validateReadme(files.readme, repositories, draft)
  } catch (error) {
    if (error instanceof SnapshotValidationError) {
      throw new PublicationError('snapshot_invalid', { count: error.count, paths: error.paths })
    }
    throw new PublicationError('snapshot_invalid')
  }
  const hash = createHash('sha256')
    .update(JSON.stringify([files.readme, files.reposJson, files.statsJson]), 'utf8')
    .digest('hex')
  return { files, hash }
}

/**
 * Pin the date and all three rendered file contents to this completed crawl.
 * Re-entering with another clock value checks the existing draft rather than replacing it.
 */
export function prepareDraft(db: Database.Database, runId: string, now: Date): RunDraft {
  return databaseResult(() =>
    db.transaction(() => {
      const run = getRun(db, runId)
      if (run?.status !== 'completed' || run.completed_at === null || run.last_error !== null) throw new PublicationError('invalid_run')
      let draft: RunDraft
      if (run.draft_id !== null || run.draft_date !== null || run.draft_size !== null || run.draft_hash !== null) {
        draft = savedDraft(run)
      } else {
        try {
          draft = { ...createStatsDraft(historicalStats(db), listPublishable(db).length, now), hash: '' }
        } catch {
          throw new PublicationError('draft_invalid')
        }
      }
      const snapshot = renderFiles(db, draft)
      if (draft.hash) {
        if (draft.hash !== snapshot.hash) throw new PublicationError('snapshot_changed')
      } else {
        draft.hash = snapshot.hash
        try {
          saveRunDraft(db, runId, draft)
        } catch {
          throw new PublicationError('database_error')
        }
      }
      return draft
    })(),
  )
}

function checkedSnapshot(db: Database.Database, runId: string): { draft: RunDraft; files: GitSnapshotFiles; pending: string | null } {
  return databaseResult(() =>
    db.transaction(() => {
      const run = getRun(db, runId)
      if (run?.status !== 'completed' || run.completed_at === null || run.last_error !== null) throw new PublicationError('invalid_run')
      const draft = savedDraft(run)
      const { files, hash } = renderFiles(db, draft)
      if (draft.hash !== hash) throw new PublicationError('snapshot_changed')
      return { draft, files, pending: run.pending_commit_sha }
    })(),
  )
}

export function readDraftSnapshot(db: Database.Database, runId: string): GitSnapshotFiles {
  return checkedSnapshot(db, runId).files
}

function recordPublication(db: Database.Database, runId: string, draft: RunDraft, sha: string, owner: string): void {
  try {
    markPublished(
      db,
      runId,
      {
        date: draft.date,
        size: draft.size,
        commitSha: sha,
        publishedAt: new Date().toISOString(),
      },
      owner,
    )
  } catch {
    throw new PublicationError('database_error')
  }
}

function rememberPending(db: Database.Database, runId: string, sha: string, previousSha: string | null): void {
  try {
    if (!setPendingCommit(db, runId, sha, previousSha)) throw new Error('Run is no longer completed')
  } catch {
    throw new PublicationError('database_error')
  }
}

async function reachable(git: GitHubGit, pending: string, historyLimit?: number): Promise<boolean> {
  try {
    return await git.isCommitReachable(pending, historyLimit)
  } catch {
    // A 404 or a traversal limit does not prove the pending commit is absent.
    throw new PublicationError('git_indeterminate')
  }
}

async function update(git: GitHubGit, sha: string): Promise<'updated' | 'conflict'> {
  try {
    await git.updateBranch(sha)
    return 'updated'
  } catch (error) {
    if (error instanceof GitHubGitConflictError) return 'conflict'
    // PATCH can have succeeded even if its acknowledgement was lost.
    throw new PublicationError('git_indeterminate')
  }
}

function validatePublication(
  run: RunRow | null,
  options: { writeEnabled?: boolean; recover?: boolean; historyLimit?: number },
): { run: RunRow; draft: RunDraft } {
  if (options.writeEnabled !== true) throw new PublicationError('write_disabled')
  if (run?.status !== 'completed' || run.completed_at === null || run.last_error !== null) throw new PublicationError('invalid_run')
  if (
    options.historyLimit !== undefined &&
    (!options.recover || !Number.isSafeInteger(options.historyLimit) || options.historyLimit < 257 || options.historyLimit > 2048)
  ) {
    throw new PublicationError('invalid_run')
  }
  return { run, draft: savedDraft(run) }
}

function claimPublishLease(db: Database.Database, runId: string, owner: string, recover: boolean | undefined): void {
  try {
    claimPublicationLease(db, runId, owner, recover)
  } catch (error) {
    if (error instanceof PublicationLeaseError) throw new PublicationError(error.category)
    throw new PublicationError('database_error')
  }
}

async function resumePendingCommit(
  db: Database.Database,
  git: GitHubGit,
  runId: string,
  run: RunRow,
  draft: RunDraft,
  owner: string,
  historyLimit: number | undefined,
): Promise<string | { snapshot: ReturnType<typeof checkedSnapshot> }> {
  if (run.pending_commit_sha && (await reachable(git, run.pending_commit_sha, historyLimit))) {
    recordPublication(db, runId, draft, run.pending_commit_sha, owner)
    return run.pending_commit_sha
  }
  const snapshot = checkedSnapshot(db, runId)
  if (snapshot.pending) {
    if (snapshot.pending !== run.pending_commit_sha) throw new PublicationError('git_indeterminate')
    if ((await update(git, snapshot.pending)) === 'updated') {
      recordPublication(db, runId, snapshot.draft, snapshot.pending, owner)
      return snapshot.pending
    }
  }
  return { snapshot }
}

async function createAndPublishSnapshot(
  db: Database.Database,
  git: GitHubGit,
  runId: string,
  owner: string,
  snapshot: ReturnType<typeof checkedSnapshot>,
): Promise<string> {
  let expectedPending = snapshot.pending
  for (let attempt = 0; attempt < 3; attempt++) {
    let commit: string
    try {
      const head = await git.getBranchHead()
      const tree = await git.createTree(head.treeSha, snapshot.files)
      commit = await git.createCommit(tree, head.sha, `Update catalog snapshot for run ${runId}`)
    } catch {
      throw new PublicationError('git_error')
    }
    rememberPending(db, runId, commit, expectedPending)
    expectedPending = commit
    if ((await update(git, commit)) === 'updated') {
      recordPublication(db, runId, snapshot.draft, commit, owner)
      return commit
    }
  }
  throw new PublicationError('git_conflict')
}

function releaseUnpublishedLease(db: Database.Database, runId: string, owner: string): void {
  const current = databaseResult(() => getRun(db, runId))
  if (current?.status === 'completed' && current.pending_commit_sha === null) {
    databaseResult(() => releasePublicationLease(db, runId, owner))
  }
}

export async function publishRun(
  db: Database.Database,
  git: GitHubGit,
  runId: string,
  options: { writeEnabled?: boolean; recover?: boolean; historyLimit?: number } = {},
): Promise<string> {
  const run = databaseResult(() => getRun(db, runId))
  if (run?.status === 'published') {
    return publishedCommit(db, runId)
  }
  const { run: completedRun, draft: prepared } = validatePublication(run, options)
  const owner = randomUUID()
  claimPublishLease(db, runId, owner, options.recover)
  try {
    const pending = await resumePendingCommit(db, git, runId, completedRun, prepared, owner, options.historyLimit)
    if (typeof pending === 'string') return pending
    return createAndPublishSnapshot(db, git, runId, owner, pending.snapshot)
  } finally {
    // Once a candidate SHA exists, retain the lease until its Git visibility is reconciled.
    releaseUnpublishedLease(db, runId, owner)
  }
}
