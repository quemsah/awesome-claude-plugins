import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, expect, it } from 'vitest'
import { openDatabase } from '../storage/db.js'
import { beginRun, completeRun, failRun, getRun } from '../storage/runs.js'
import { type GitHubGit, GitHubGitConflictError, GitHubGitHttpError, GitHubGitTimeoutError, type GitSnapshotFiles } from './githubGit.js'
import { PublicationError, prepareDraft, publishRun, readDraftSnapshot } from './publishRun.js'

const databases: Database.Database[] = []
const directories: string[] = []
const timestamp = new Date('2025-07-02T12:30:00.000Z')
const sha = (id: number) => id.toString(16).padStart(40, '0')

function fixture(): Database.Database {
  const directory = mkdtempSync(join(import.meta.dirname, '.publication-'))
  directories.push(directory)
  const db = openDatabase(join(directory, 'catalog.sqlite'))
  databases.push(db)
  db.prepare(`INSERT INTO repositories (
    id, html_url, stargazers_count, forks_count, subscribers_count, description,
    owner, owner_url, repo_name, plugins_count, createdAt, updatedAt
  ) VALUES (18, 'https://github.com/example/plugin', 42, 2, 3, 'Hello',
    'example', 'https://github.com/example', 'plugin', 1, 'start', 'start')`).run()
  db.prepare(`INSERT INTO stats (id, date, size, createdAt, updatedAt)
    VALUES (264, '2024-01-01T00:00:00.000Z', 4, 'start', 'start')`).run()
  beginRun(db, 'r1', timestamp.toISOString())
  completeRun(db, 'r1', timestamp.toISOString(), 0)
  return db
}

function publicationLease(db: Database.Database): { run_id: string } | undefined {
  return db.prepare('SELECT run_id FROM publication_lease').get() as { run_id: string } | undefined
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

class Branch implements GitHubGit {
  head = sha(1)
  next = 2
  events: string[] = []
  messages: string[] = []
  commits = new Map<string, { parent: string | null; tree: string }>([[this.head, { parent: null, tree: sha(100) }]])
  files: GitSnapshotFiles[] = []
  failure:
    | 'head'
    | 'tree'
    | 'commit-before'
    | 'commit-after'
    | 'patch-before'
    | 'patch-after'
    | 'patch-rejected'
    | 'history-404'
    | 'history-indeterminate'
    | null = null
  conflictCount = 0
  patches = 0

  async getBranchHead() {
    this.events.push('GET ref', 'GET commit')
    if (this.failure === 'head') throw new GitHubGitHttpError(404)
    const commit = this.commits.get(this.head)
    if (!commit) throw new Error('Fake branch has no HEAD commit')
    return { sha: this.head, treeSha: commit.tree }
  }

  async createTree(baseTreeSha: string, files: GitSnapshotFiles) {
    this.events.push(`POST tree ${baseTreeSha}`)
    if (this.failure === 'tree') throw new GitHubGitHttpError(503)
    this.files.push(files)
    return sha(this.next++)
  }

  async createCommit(treeSha: string, parentSha: string, message: string) {
    this.events.push(`POST commit ${parentSha}`)
    this.messages.push(message)
    if (this.failure === 'commit-before') throw new GitHubGitTimeoutError()
    const commit = sha(this.next++)
    this.commits.set(commit, { parent: parentSha, tree: treeSha })
    if (this.failure === 'commit-after') throw new GitHubGitTimeoutError()
    return commit
  }

  async updateBranch(commit: string) {
    this.events.push(`PATCH ${commit} force:false`)
    if (this.failure === 'patch-before') throw new GitHubGitTimeoutError()
    if (this.failure === 'patch-rejected') throw new GitHubGitHttpError(422)
    if (this.conflictCount-- > 0 || this.commits.get(commit)?.parent !== this.head) throw new GitHubGitConflictError(422)
    this.head = commit
    this.patches++
    if (this.failure === 'patch-after') throw new GitHubGitTimeoutError()
  }

  async isCommitReachable(commit: string) {
    this.events.push(`ANCESTRY ${commit}`)
    if (this.failure === 'history-404') throw new GitHubGitHttpError(404)
    if (this.failure === 'history-indeterminate') throw new GitHubGitHttpError(503)
    let cursor: string | null = this.head
    while (cursor) {
      if (cursor === commit) return true
      cursor = this.commits.get(cursor)?.parent ?? null
    }
    return false
  }

  advance(): void {
    const commit = sha(this.next++)
    this.commits.set(commit, { parent: this.head, tree: sha(this.next++) })
    this.head = commit
  }
}

it('prepares four deterministic files and a durable run-bound draft without adding stats or calling Git', () => {
  const db = fixture()
  const first = prepareDraft(db, 'r1', timestamp)
  expect(first).toMatchObject({ id: 265, date: '2025-07-02T12:30:00.000Z', size: 1 })
  expect(first.hash).toMatch(/^[0-9a-f]{64}$/)
  expect(getRun(db, 'r1')).toMatchObject({
    draft_date: first.date,
    draft_id: 265,
    draft_size: 1,
    draft_hash: first.hash,
    pending_commit_sha: null,
  })
  expect(db.prepare('SELECT id FROM stats ORDER BY id').all()).toEqual([{ id: 264 }])
  expect(prepareDraft(db, 'r1', new Date('2026-01-01'))).toEqual(first)
  expect(getRun(db, 'r1')?.draft_date).toBe(first.date)
})

it('refuses noncompleted and zero-progress-gated runs without persisting a draft', () => {
  const db = fixture()
  beginRun(db, 'active', timestamp.toISOString())
  expect(() => prepareDraft(db, 'active', timestamp)).toThrowError(PublicationError)
  failRun(db, 'active', timestamp.toISOString(), 'no_successful_ranges')
  expect(() => prepareDraft(db, 'active', timestamp)).toThrowError(PublicationError)
  beginRun(db, 'no-conclusive', timestamp.toISOString())
  failRun(db, 'no-conclusive', timestamp.toISOString(), 'no_conclusive_enrichment')
  expect(() => prepareDraft(db, 'no-conclusive', timestamp)).toThrowError(PublicationError)
  expect(getRun(db, 'active')?.draft_hash).toBeNull()
})

it('fails preparation on an invalid catalog or conflicting historical date and keeps the run untouched', () => {
  const db = fixture()
  expect(() => prepareDraft(db, 'r1', new Date('2024-01-01T00:00:00Z'))).toThrowError(PublicationError)
  expect(getRun(db, 'r1')?.draft_id).toBeNull()
  db.prepare('DELETE FROM repositories').run()
  expect(() => prepareDraft(db, 'r1', timestamp)).toThrowError(
    expect.objectContaining({
      category: 'snapshot_invalid',
      validation: { count: 1, paths: ['repos'] },
    }),
  )
  expect(getRun(db, 'r1')?.draft_id).toBeNull()
})

it('flattens a forged ranked README row into safe description text before preparing the draft', () => {
  const db = fixture()
  db.prepare('UPDATE repositories SET description = ? WHERE id = 18').run('safe\n| 1 | [spoof](https://github.com/example/spoof) | ')

  prepareDraft(db, 'r1', timestamp)

  const readme = readDraftSnapshot(db, 'r1').readme
  expect(readme).not.toMatch(/^\| 1 \| \[spoof\]/m)
  expect(readme).toContain('safe &#124; 1 &#124; [spoof](https://github.com/example/spoof) &#124;')
  expect(getRun(db, 'r1')?.draft_hash).toMatch(/^[0-9a-f]{64}$/)
})

it('cannot partially persist a draft if SQLite rejects the run update', () => {
  const db = fixture()
  db.exec(`CREATE TRIGGER reject_draft BEFORE UPDATE OF draft_hash ON runs BEGIN SELECT RAISE(ABORT, 'no draft'); END`)
  expect(() => prepareDraft(db, 'r1', timestamp)).toThrow()
  expect(getRun(db, 'r1')?.draft_hash).toBeNull()
  expect(db.prepare('SELECT COUNT(*) AS count FROM stats').get()).toEqual({ count: 1 })
})

it('refuses preparation after the catalog changes instead of replacing its date or hash', () => {
  const db = fixture()
  const original = prepareDraft(db, 'r1', timestamp)
  db.prepare('UPDATE repositories SET stargazers_count = 99 WHERE id = 18').run()
  expect(() => prepareDraft(db, 'r1', new Date('2027-01-01'))).toThrowError(PublicationError)
  expect(getRun(db, 'r1')?.draft_hash).toBe(original.hash)
})

it('defaults to no writes; a prepared draft publishes exactly four files in one commit and records stats once', async () => {
  const db = fixture()
  const git = new Branch()
  const draft = prepareDraft(db, 'r1', timestamp)
  await expect(publishRun(db, git, 'r1')).rejects.toMatchObject({ category: 'write_disabled' })
  await expect(publishRun(db, git, 'r1', { writeEnabled: false })).rejects.toMatchObject({ category: 'write_disabled' })
  expect(git.events).toEqual([])
  const commit = await publishRun(db, git, 'r1', { writeEnabled: true })
  expect(commit).toBe(git.head)
  expect(git.messages).toEqual(['chore(data): refresh dataset 02.07.2025'])
  expect(git.events).toEqual(['GET ref', 'GET commit', `POST tree ${sha(100)}`, `POST commit ${sha(1)}`, `PATCH ${commit} force:false`])
  expect(git.files).toHaveLength(1)
  expect(Object.keys(git.files[0]).sort()).toEqual(['markdownPathsJson', 'readme', 'reposJson', 'statsJson'])
  const { readme, reposJson, statsJson, markdownPathsJson } = git.files[0]
  expect(draft.hash).toBe(
    createHash('sha256')
      .update(JSON.stringify([readme, reposJson, statsJson, markdownPathsJson]), 'utf8')
      .digest('hex'),
  )
  expect(git.files[0].readme).toContain('Last updated: 02.07.2025 with 1 total repositories indexed.')
  expect(JSON.parse(git.files[0].markdownPathsJson)).toEqual([])
  expect(JSON.parse(git.files[0].statsJson)).toEqual([
    { id: 264, date: '2024-01-01T00:00:00.000Z', size: 4 },
    { id: 265, date: draft.date, size: draft.size },
  ])
  expect(db.prepare('SELECT id, date, size, run_id FROM stats ORDER BY id').all()).toEqual([
    { id: 264, date: '2024-01-01T00:00:00.000Z', size: 4, run_id: null },
    { id: 265, date: draft.date, size: 1, run_id: 'r1' },
  ])
  expect(getRun(db, 'r1')).toMatchObject({ status: 'published', commit_sha: commit, pending_commit_sha: null })
  expect(await publishRun(db, git, 'r1', { writeEnabled: true })).toBe(commit)
  expect(await publishRun(db, git, 'r1')).toBe(commit)
  expect(git.events).toHaveLength(5)
})

it('accepts a legacy three-file draft hash when recovering a draft prepared before the markdown sidecar existed', async () => {
  const db = fixture()
  const git = new Branch()
  prepareDraft(db, 'r1', timestamp)
  const files = readDraftSnapshot(db, 'r1')
  const legacyHash = createHash('sha256')
    .update(JSON.stringify([files.readme, files.reposJson, files.statsJson]), 'utf8')
    .digest('hex')
  db.prepare('UPDATE runs SET draft_hash = ? WHERE run_id = ?').run(legacyHash, 'r1')

  expect(() => prepareDraft(db, 'r1', new Date('2027-01-01'))).not.toThrow()
  expect(getRun(db, 'r1')?.draft_hash).toBe(legacyHash)

  const commit = await publishRun(db, git, 'r1', { writeEnabled: true })
  expect(commit).toBe(git.head)
  expect(git.files).toHaveLength(1)
  expect(git.files[0].markdownPathsJson).toBe(files.markdownPathsJson)
})

it('still rejects catalog changes when a persisted draft uses the legacy three-file hash', async () => {
  const db = fixture()
  const git = new Branch()
  prepareDraft(db, 'r1', timestamp)
  const files = readDraftSnapshot(db, 'r1')
  const legacyHash = createHash('sha256')
    .update(JSON.stringify([files.readme, files.reposJson, files.statsJson]), 'utf8')
    .digest('hex')
  db.prepare('UPDATE runs SET draft_hash = ? WHERE run_id = ?').run(legacyHash, 'r1')
  db.prepare('UPDATE repositories SET description = ? WHERE id = 18').run('changed after legacy draft')

  await expect(publishRun(db, git, 'r1', { writeEnabled: true })).rejects.toMatchObject({ category: 'snapshot_changed' })
  expect(git.events).toEqual([])
})

it('does not touch Git for a missing draft, changed catalog, corrupted hash, or historical id/date collision', async () => {
  const db = fixture()
  const git = new Branch()
  await expect(publishRun(db, git, 'r1', { writeEnabled: true })).rejects.toThrowError(PublicationError)
  const draft = prepareDraft(db, 'r1', timestamp)
  db.prepare('UPDATE repositories SET description = ? WHERE id = 18').run('changed')
  await expect(publishRun(db, git, 'r1', { writeEnabled: true })).rejects.toMatchObject({ category: 'snapshot_changed' })
  db.prepare('UPDATE repositories SET description = ? WHERE id = 18').run('Hello')
  db.prepare('UPDATE runs SET draft_hash = ? WHERE run_id = ?').run('0'.repeat(64), 'r1')
  await expect(publishRun(db, git, 'r1', { writeEnabled: true })).rejects.toMatchObject({ category: 'snapshot_changed' })
  db.prepare('UPDATE runs SET draft_hash = ? WHERE run_id = ?').run(draft.hash, 'r1')
  db.prepare("INSERT INTO stats (id, date, size, createdAt, updatedAt) VALUES (265, '2025-01-01', 1, 'x', 'x')").run()
  await expect(publishRun(db, git, 'r1', { writeEnabled: true })).rejects.toThrowError(PublicationError)
  expect(git.events).toEqual([])
})

it('does not append stats if tree, commit or PATCH fails, and retries a known pending commit', async () => {
  for (const failure of ['head', 'tree', 'commit-before', 'patch-before'] as const) {
    const db = fixture()
    const git = new Branch()
    prepareDraft(db, 'r1', timestamp)
    git.failure = failure
    await expect(publishRun(db, git, 'r1', { writeEnabled: true })).rejects.toThrowError(PublicationError)
    expect(db.prepare('SELECT COUNT(*) AS count FROM stats').get()).toEqual({ count: 1 })
    expect(getRun(db, 'r1')?.status).toBe('completed')
    git.failure = null
    const commit = await publishRun(db, git, 'r1', { writeEnabled: true, recover: getRun(db, 'r1')?.pending_commit_sha !== null })
    expect(git.patches).toBe(1)
    expect(git.head).toBe(commit)
  }
})

it('recovers a POST commit timeout without publishing an orphaned commit or duplicating stats', async () => {
  const db = fixture()
  const git = new Branch()
  prepareDraft(db, 'r1', timestamp)
  git.failure = 'commit-after'
  await expect(publishRun(db, git, 'r1', { writeEnabled: true })).rejects.toThrowError(PublicationError)
  expect(getRun(db, 'r1')?.pending_commit_sha).toBeNull()
  git.failure = null
  const visible = await publishRun(db, git, 'r1', { writeEnabled: true })
  expect(git.head).toBe(visible)
  expect(git.patches).toBe(1)
  expect(db.prepare("SELECT COUNT(*) AS count FROM stats WHERE run_id = 'r1'").get()).toEqual({ count: 1 })
})

it('does not PATCH if persisting the pending SHA fails after POST commit', async () => {
  const db = fixture()
  const git = new Branch()
  prepareDraft(db, 'r1', timestamp)
  db.exec(`CREATE TRIGGER reject_pending BEFORE UPDATE OF pending_commit_sha ON runs BEGIN SELECT RAISE(ABORT, 'disk failure'); END`)
  await expect(publishRun(db, git, 'r1', { writeEnabled: true })).rejects.toMatchObject({ category: 'database_error' })
  expect(git.events.some((event) => event.startsWith('POST commit'))).toBe(true)
  expect(git.events.some((event) => event.startsWith('PATCH'))).toBe(false)
  expect(getRun(db, 'r1')?.pending_commit_sha).toBeNull()
  db.exec('DROP TRIGGER reject_pending')
  const commit = await publishRun(db, git, 'r1', { writeEnabled: true })
  expect(git.patches).toBe(1)
  expect(db.prepare('SELECT id, run_id FROM stats ORDER BY id DESC LIMIT 1').get()).toEqual({ id: 265, run_id: 'r1' })
  expect(commit).toBe(git.head)
})

it('recovers an ambiguous PATCH timeout by checking ancestry without creating or patching again', async () => {
  const db = fixture()
  const git = new Branch()
  prepareDraft(db, 'r1', timestamp)
  git.failure = 'patch-after'
  await expect(publishRun(db, git, 'r1', { writeEnabled: true })).rejects.toMatchObject({ category: 'git_indeterminate' })
  const pending = getRun(db, 'r1')?.pending_commit_sha
  expect(pending).toBe(git.head)
  expect(db.prepare('SELECT COUNT(*) AS count FROM stats').get()).toEqual({ count: 1 })
  git.failure = null
  const before = git.events.length
  expect(await publishRun(db, git, 'r1', { writeEnabled: true, recover: true })).toBe(pending)
  expect(git.events.slice(before)).toEqual([`ANCESTRY ${pending}`])
  expect(git.patches).toBe(1)
  expect(db.prepare("SELECT COUNT(*) AS count FROM stats WHERE run_id = 'r1'").get()).toEqual({ count: 1 })
})

it('reconciles a pending SHA behind a later unrelated branch commit after SQLite fails', async () => {
  const db = fixture()
  const git = new Branch()
  prepareDraft(db, 'r1', timestamp)
  db.exec(`CREATE TRIGGER reject_publication BEFORE UPDATE OF published_at ON runs BEGIN SELECT RAISE(ABORT, 'interrupted'); END`)
  await expect(publishRun(db, git, 'r1', { writeEnabled: true })).rejects.toThrowError(PublicationError)
  const published = git.head
  expect(getRun(db, 'r1')?.pending_commit_sha).toBe(published)
  expect(publicationLease(db)?.run_id).toBe('r1')
  expect(() => beginRun(db, 'next', timestamp.toISOString())).toThrow()
  expect(db.prepare('SELECT COUNT(*) AS count FROM stats').get()).toEqual({ count: 1 })
  git.advance()
  db.exec('DROP TRIGGER reject_publication')
  const before = git.events.length
  expect(await publishRun(db, git, 'r1', { writeEnabled: true, recover: true })).toBe(published)
  expect(git.events.slice(before)).toEqual([`ANCESTRY ${published}`])
  expect(git.head).not.toBe(published)
  expect(git.patches).toBe(1)
  expect(publicationLease(db)).toBeUndefined()
})

it('reconciles an already visible pending commit after the catalog changes without a second Git write', async () => {
  const db = fixture()
  const git = new Branch()
  const draft = prepareDraft(db, 'r1', timestamp)
  db.exec(`CREATE TRIGGER reject_publication BEFORE UPDATE OF published_at ON runs BEGIN SELECT RAISE(ABORT, 'interrupted'); END`)
  await expect(publishRun(db, git, 'r1', { writeEnabled: true })).rejects.toMatchObject({ category: 'database_error' })
  const pending = getRun(db, 'r1')?.pending_commit_sha
  expect(pending).toBe(git.head)
  expect(db.prepare('SELECT id FROM stats ORDER BY id').all()).toEqual([{ id: 264 }])

  git.advance()
  db.prepare('UPDATE repositories SET description = ? WHERE id = 18').run('New crawl changed this row')
  db.exec('DROP TRIGGER reject_publication')
  const before = git.events.length
  expect(await publishRun(db, git, 'r1', { writeEnabled: true, recover: true })).toBe(pending)
  expect(git.events.slice(before)).toEqual([`ANCESTRY ${pending}`])
  expect(git.patches).toBe(1)
  expect(db.prepare("SELECT id, date, size, run_id FROM stats WHERE run_id = 'r1'").all()).toEqual([
    { id: draft.id, date: draft.date, size: draft.size, run_id: 'r1' },
  ])
  expect(getRun(db, 'r1')).toMatchObject({ status: 'published', commit_sha: pending, pending_commit_sha: null })
})

it('does not write a stale pending commit when Git has not published it and SQLite has changed', async () => {
  const db = fixture()
  const git = new Branch()
  prepareDraft(db, 'r1', timestamp)
  git.failure = 'patch-before'
  await expect(publishRun(db, git, 'r1', { writeEnabled: true })).rejects.toMatchObject({ category: 'git_indeterminate' })
  const pending = getRun(db, 'r1')?.pending_commit_sha
  db.prepare('UPDATE repositories SET description = ? WHERE id = 18').run('New crawl changed this row')
  git.failure = null
  const before = git.events.length
  await expect(publishRun(db, git, 'r1', { writeEnabled: true, recover: true })).rejects.toMatchObject({ category: 'snapshot_changed' })
  expect(git.events.slice(before)).toEqual([`ANCESTRY ${pending}`])
  expect(git.patches).toBe(0)
  expect(getRun(db, 'r1')?.pending_commit_sha).toBe(pending)
  expect(db.prepare("SELECT COUNT(*) AS count FROM stats WHERE run_id = 'r1'").get()).toEqual({ count: 0 })
})

it('refuses an idempotent success if the published stats row or commit metadata is missing or corrupt', async () => {
  for (const corrupt of [
    "DELETE FROM stats WHERE run_id = 'r1'",
    "UPDATE stats SET size = 999 WHERE run_id = 'r1'",
    "UPDATE stats SET date = '2026-01-01T00:00:00.000Z' WHERE run_id = 'r1'",
    "UPDATE stats SET id = 999 WHERE run_id = 'r1'",
    "UPDATE runs SET commit_sha = 'invalid' WHERE run_id = 'r1'",
    "UPDATE runs SET published_at = NULL WHERE run_id = 'r1'",
  ]) {
    const db = fixture()
    const git = new Branch()
    prepareDraft(db, 'r1', timestamp)
    await publishRun(db, git, 'r1', { writeEnabled: true })
    db.exec(corrupt)
    const before = git.events.length
    await expect(publishRun(db, git, 'r1')).rejects.toMatchObject({ category: 'invalid_run' })
    expect(git.events).toHaveLength(before)
  }
})

it('retries bounded conflicts with fresh HEAD/tree, never force-updating or losing the pending SHA', async () => {
  const db = fixture()
  const git = new (class extends Branch {
    override async updateBranch(commit: string) {
      if (this.conflictCount === 1) this.advance()
      return super.updateBranch(commit)
    }
  })()
  prepareDraft(db, 'r1', timestamp)
  git.conflictCount = 1
  const commit = await publishRun(db, git, 'r1', { writeEnabled: true })
  expect(commit).toBe(git.head)
  expect(git.events.filter((event) => event.startsWith('POST tree'))).toHaveLength(2)
  const trees = git.events.filter((event) => event.startsWith('POST tree'))
  expect(trees[0]).not.toBe(trees[1])
  expect(git.commits.get(commit)?.parent).not.toBe(sha(1))
  expect(git.events.filter((event) => event.startsWith('PATCH'))).toHaveLength(2)
  expect(git.events.every((event) => !event.includes('force:true'))).toBe(true)
})

it('retries a confirmed conflict even when the branch has more than 256 older commits', async () => {
  const db = fixture()
  const git = new (class extends Branch {
    override async updateBranch(commit: string) {
      if (this.conflictCount === 1) this.advance()
      return super.updateBranch(commit)
    }
  })()
  for (let i = 0; i < 300; i++) git.advance()
  prepareDraft(db, 'r1', timestamp)
  git.conflictCount = 1

  const commit = await publishRun(db, git, 'r1', { writeEnabled: true })

  expect(commit).toBe(git.head)
  expect(git.events.filter((event) => event.startsWith('PATCH'))).toHaveLength(2)
  expect(git.events.filter((event) => event.startsWith('ANCESTRY'))).toEqual([])
  expect(publicationLease(db)).toBeUndefined()
})

it('surfaces database failures as safe categories instead of leaking raw SQLite error text', async () => {
  const db = fixture()
  db.exec('DROP TABLE runs')
  expect(() => prepareDraft(db, 'r1', timestamp)).toThrowError(PublicationError)
  await expect(publishRun(db, new Branch(), 'r1', { writeEnabled: true })).rejects.toMatchObject({ category: 'database_error' })
})

it('keeps a pending SHA and refuses to write when ancestry is 404 or indeterminate', async () => {
  for (const failure of ['history-404', 'history-indeterminate'] as const) {
    const db = fixture()
    const git = new Branch()
    prepareDraft(db, 'r1', timestamp)
    git.failure = 'patch-before'
    await expect(publishRun(db, git, 'r1', { writeEnabled: true })).rejects.toThrowError(PublicationError)
    const pending = getRun(db, 'r1')?.pending_commit_sha
    git.failure = failure
    const before = git.events.length
    await expect(publishRun(db, git, 'r1', { writeEnabled: true, recover: true })).rejects.toMatchObject({ category: 'git_indeterminate' })
    expect(git.events.slice(before)).toEqual([`ANCESTRY ${pending}`])
    expect(getRun(db, 'r1')?.pending_commit_sha).toBe(pending)
  }
})

it('clears rejected candidates and releases the lease after repeated ref conflicts', async () => {
  const db = fixture()
  const git = new Branch()
  prepareDraft(db, 'r1', timestamp)
  git.conflictCount = 100
  await expect(publishRun(db, git, 'r1', { writeEnabled: true })).rejects.toMatchObject({ category: 'git_conflict' })
  expect(git.events.filter((event) => event.startsWith('PATCH'))).toHaveLength(3)
  expect(getRun(db, 'r1')?.pending_commit_sha).toBeNull()
  expect(publicationLease(db)).toBeUndefined()
  expect(db.prepare('SELECT COUNT(*) AS count FROM stats').get()).toEqual({ count: 1 })
})

it('clears pending and releases the lease after a confirmed PATCH validation rejection', async () => {
  const db = fixture()
  const git = new Branch()
  prepareDraft(db, 'r1', timestamp)
  git.failure = 'patch-rejected'
  await expect(publishRun(db, git, 'r1', { writeEnabled: true })).rejects.toMatchObject({ category: 'git_error' })
  expect(getRun(db, 'r1')?.pending_commit_sha).toBeNull()
  expect(publicationLease(db)).toBeUndefined()
  expect(git.patches).toBe(0)
  expect(db.prepare('SELECT COUNT(*) AS count FROM stats').get()).toEqual({ count: 1 })
})

it('holds a durable lease across an in-flight PATCH so neither another publisher nor a crawl can overtake it', async () => {
  const db = fixture()
  const competingDb = openDatabase(db.name)
  databases.push(competingDb)
  beginRun(db, 'r2', new Date(timestamp.getTime() + 1000).toISOString())
  completeRun(db, 'r2', new Date(timestamp.getTime() + 1000).toISOString(), 0)
  prepareDraft(db, 'r1', timestamp)
  prepareDraft(db, 'r2', new Date(timestamp.getTime() + 1000))
  let releasePatch: () => void = () => {}
  let patchStarted: () => void = () => {}
  const patchEntered = new Promise<void>((resolve) => {
    patchStarted = resolve
  })
  const patchGate = new Promise<void>((resolve) => {
    releasePatch = resolve
  })
  const git = new (class extends Branch {
    override async updateBranch(commit: string) {
      patchStarted()
      await patchGate
      return super.updateBranch(commit)
    }
  })()
  const publishing = publishRun(db, git, 'r1', { writeEnabled: true })
  await patchEntered
  expect(publicationLease(db)?.run_id).toBe('r1')
  expect(() => beginRun(competingDb, 'r3', timestamp.toISOString())).toThrow()
  await expect(publishRun(competingDb, git, 'r2', { writeEnabled: true })).rejects.toMatchObject({ category: 'publication_locked' })
  await expect(publishRun(db, git, 'r1', { writeEnabled: true })).rejects.toMatchObject({ category: 'publication_locked' })
  releasePatch()
  await publishing
  expect(git.patches).toBe(1)
  expect(db.prepare("SELECT COUNT(*) AS count FROM stats WHERE run_id = 'r1'").get()).toEqual({ count: 1 })
  expect(db.prepare("SELECT COUNT(*) AS count FROM stats WHERE run_id = 'r2'").get()).toEqual({ count: 0 })
  expect(publicationLease(db)).toBeUndefined()
  await expect(publishRun(db, git, 'r2', { writeEnabled: true })).rejects.toMatchObject({ category: 'historical_conflict' })
  expect(git.patches).toBe(1)
})
