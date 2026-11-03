import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, expect, it } from 'vitest'
import { renderRepos } from '../output/catalogSnapshot.js'
import { renderReadme } from '../output/readme.js'
import { openDatabase } from '../storage/db.js'
import { listPublishable } from '../storage/repositories.js'
import { beginRun, completeRun, failRun, getRun } from '../storage/runs.js'
import { type CatalogReleasePointer, getArtifactPublication } from './artifactPublisher.js'
import { type GitHubGit, GitHubGitConflictError, GitHubGitHttpError, GitHubGitTimeoutError, type GitSnapshotFiles } from './githubGit.js'
import { PublicationError, prepareDraft, publishRun, readDraftSnapshot, resolveArtifactPaths } from './publishRun.js'

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
  uploadedAssets: { tagName: string; assetName: string; filePath: string }[] = []
  uploadFailure: string | null = null

  uploadReleaseAsset?:
    | ((tagName: string, assetName: string, filePath: string) => Promise<{ downloadUrl: string; sha256: string }>)
    | undefined = async (tagName, assetName, filePath) => {
    this.events.push(`POST release-asset ${tagName}/${assetName}`)
    if (this.uploadFailure) throw new Error(this.uploadFailure)
    this.uploadedAssets.push({ tagName, assetName, filePath })
    const fileBytes = readFileSync(filePath)
    const sha256 = createHash('sha256').update(fileBytes).digest('hex')
    return {
      downloadUrl: `https://github.com/example/repo/releases/download/${tagName}/${assetName}`,
      sha256,
    }
  }

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
  const tempDir = mkdtempSync(join(tmpdir(), 'publish-run-test-'))
  directories.push(tempDir)
  const paths = {
    artifactOutputPath: join(tempDir, 'catalog.sqlite'),
    releasePointerPath: join(tempDir, 'catalog-release.json'),
  }
  const draft = prepareDraft(db, 'r1', timestamp, paths)
  await expect(publishRun(db, git, 'r1', paths)).rejects.toMatchObject({ category: 'write_disabled' })
  await expect(publishRun(db, git, 'r1', { writeEnabled: false, ...paths })).rejects.toMatchObject({ category: 'write_disabled' })
  expect(git.events).toEqual([])
  const commit = await publishRun(db, git, 'r1', { writeEnabled: true, ...paths })
  expect(commit).toBe(git.head)
  expect(git.messages).toEqual(['chore(data): refresh dataset 02.07.2025'])
  expect(git.events).toEqual([
    expect.stringMatching(/^POST release-asset /),
    'GET ref',
    'GET commit',
    `POST tree ${sha(100)}`,
    `POST commit ${sha(1)}`,
    `PATCH ${commit} force:false`,
  ])
  expect(git.files).toHaveLength(1)
  expect(Object.keys(git.files[0]).sort()).toEqual(['catalogReleaseJson', 'markdownPathsJson', 'readme', 'reposJson', 'statsJson'])
  const { readme, reposJson, statsJson, markdownPathsJson, catalogReleaseJson } = git.files[0]
  if (!catalogReleaseJson || !markdownPathsJson || !statsJson) {
    throw new Error('Expected files to be defined')
  }
  expect(JSON.parse(catalogReleaseJson)).toMatchObject({
    schemaVersion: 1,
  })
  expect(draft.hash).toBe(
    createHash('sha256')
      .update(JSON.stringify([readme, reposJson, statsJson, markdownPathsJson]), 'utf8')
      .digest('hex'),
  )
  expect(git.files[0].readme).toContain('Last updated: 02.07.2025 with 1 total repositories indexed.')
  expect(JSON.parse(markdownPathsJson)).toEqual([])
  expect(JSON.parse(statsJson)).toEqual([
    { id: 264, date: '2024-01-01T00:00:00.000Z', size: 4 },
    { id: 265, date: draft.date, size: draft.size },
  ])
  expect(db.prepare('SELECT id, date, size, run_id FROM stats ORDER BY id').all()).toEqual([
    { id: 264, date: '2024-01-01T00:00:00.000Z', size: 4, run_id: null },
    { id: 265, date: draft.date, size: 1, run_id: 'r1' },
  ])
  expect(db.prepare('SELECT state FROM artifact_publications WHERE run_id = ?').get('r1')).toEqual({
    state: 'uploaded',
  })
  expect(getRun(db, 'r1')).toMatchObject({ status: 'published', commit_sha: commit, pending_commit_sha: null })
  expect(await publishRun(db, git, 'r1', { writeEnabled: true, ...paths })).toBe(commit)
  expect(await publishRun(db, git, 'r1', paths)).toBe(commit)
  expect(git.events).toHaveLength(6)
})

it('prepares and publishes in sqlite-native mode without rendering legacy json files', async () => {
  const db = fixture()
  const git = new Branch()
  const tempDir = mkdtempSync(join(tmpdir(), 'publish-run-native-'))
  directories.push(tempDir)
  const paths = {
    artifactOutputPath: join(tempDir, 'catalog.sqlite'),
    releasePointerPath: join(tempDir, 'catalog-release.json'),
    allowLegacyJsonPublication: false,
  }
  const draft = prepareDraft(db, 'r1', timestamp, paths)
  const expectedHash = createHash('sha256')
    .update(JSON.stringify([renderReadme(listPublishable(db), draft), 'sqlite-catalog', draft.id, draft.date, draft.size]), 'utf8')
    .digest('hex')
  expect(draft.hash).toBe(expectedHash)

  const commit = await publishRun(db, git, 'r1', { writeEnabled: true, ...paths })
  expect(commit).toBe(git.head)
  expect(git.files).toHaveLength(1)
  expect(Object.keys(git.files[0]).sort()).toEqual(['catalogReleaseJson', 'readme'])
  expect(git.files[0].reposJson).toBeUndefined()
  expect(git.files[0].statsJson).toBeUndefined()
  expect(git.files[0].markdownPathsJson).toBeUndefined()
  expect(db.prepare('SELECT state FROM artifact_publications WHERE run_id = ?').get('r1')).toEqual({
    state: 'uploaded',
  })
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

// Freeze the exact pre-upgrade repos.json serialization independently of renderRepos.
// A fixture derived from today's serializer would miss accidental historical byte changes.
it.each([true, false])('publishes a frozen pre-metadata draft with plugins and sidecar=%s', async (withPaths) => {
  const db = fixture()
  const git = new Branch()
  db.prepare('UPDATE repositories SET plugins_json = ?, repo_updated = ?, license = ?, archived = ? WHERE id = 18').run(
    JSON.stringify([{ name: 'one', description: 'A plugin' }]),
    '2026-10-30T10:00:00Z',
    'MIT',
    1,
  )
  db.prepare('UPDATE repositories SET catalog_updated_at = ? WHERE id = 18').run('2025-07-02T11:22:33.456Z')
  prepareDraft(db, 'r1', timestamp)
  const currentFiles = readDraftSnapshot(db, 'r1')

  // This is the prior release's byte-for-byte public record, including ordering, plugins,
  // catalog_updated_at and trailing newline, without the four new optional metadata fields.
  const preUpgradeReposJson = `[
{"stargazers_count":42,"forks_count":2,"subscribers_count":3,"description":"Hello","owner":"example","repo_name":"plugin","plugins_count":1,"plugins":[{"name":"one","description":"A plugin"}],"catalog_updated_at":"2025-07-02T11:22:33.456Z","id":18}
]
`
  expect(renderRepos(listPublishable(db), { includeNewCatalogMetadata: false })).toBe(preUpgradeReposJson)
  expect(currentFiles.reposJson).toBeDefined()
  expect(JSON.parse(currentFiles.reposJson as string)[0]).toMatchObject({
    plugins: [{ name: 'one', description: 'A plugin' }],
    license: 'MIT',
    archived: true,
    pushed_at: '2026-10-30T10:00:00.000Z',
  })
  const parts = [currentFiles.readme, preUpgradeReposJson, currentFiles.statsJson]
  if (withPaths) parts.push(currentFiles.markdownPathsJson)
  const savedHash = createHash('sha256').update(JSON.stringify(parts), 'utf8').digest('hex')
  db.prepare('UPDATE runs SET draft_hash = ? WHERE run_id = ?').run(savedHash, 'r1')

  expect(prepareDraft(db, 'r1', new Date('2027-01-01')).hash).toBe(savedHash)
  expect(readDraftSnapshot(db, 'r1').reposJson).toBe(preUpgradeReposJson)
  await publishRun(db, git, 'r1', { writeEnabled: true })
  expect(git.files[0].reposJson).toBe(preUpgradeReposJson)
})

it('recovers the previous eight-field multiline catalog serialization', async () => {
  const db = fixture()
  const git = new Branch()
  prepareDraft(db, 'r1', timestamp)
  const files = readDraftSnapshot(db, 'r1')
  const previousReposJson = renderRepos(listPublishable(db), { includeCatalogUpdatedAt: false })
  expect(previousReposJson.startsWith('[\n{')).toBe(true)
  expect(JSON.parse(previousReposJson)[0]).not.toHaveProperty('html_url')
  expect(JSON.parse(previousReposJson)[0]).not.toHaveProperty('catalog_updated_at')

  const previousHash = createHash('sha256')
    .update(JSON.stringify([files.readme, previousReposJson, files.statsJson, files.markdownPathsJson]), 'utf8')
    .digest('hex')
  db.prepare('UPDATE runs SET draft_hash = ? WHERE run_id = ?').run(previousHash, 'r1')
  expect(readDraftSnapshot(db, 'r1').reposJson).toBe(previousReposJson)

  await publishRun(db, git, 'r1', { writeEnabled: true })
  expect(git.files[0].reposJson).toBe(previousReposJson)
})

it('preserves an old catalog serialization when recovering an unpublished pending commit', async () => {
  const db = fixture()
  const git = new Branch()
  const draft = prepareDraft(db, 'r1', timestamp)
  const files = readDraftSnapshot(db, 'r1')
  const oldReposJson = renderRepos(listPublishable(db), { legacyUrls: true })
  expect(oldReposJson).toBe(
    '[{"html_url":"https://github.com/example/plugin","stargazers_count":42,"forks_count":2,"subscribers_count":3,"description":"Hello","owner":"example","owner_url":"https://github.com/example","repo_name":"plugin","plugins_count":1,"id":18}]\n',
  )
  const oldHash = createHash('sha256')
    .update(JSON.stringify([files.readme, oldReposJson, files.statsJson, files.markdownPathsJson]), 'utf8')
    .digest('hex')
  db.prepare('UPDATE runs SET draft_hash = ? WHERE run_id = ?').run(oldHash, 'r1')
  expect(prepareDraft(db, 'r1', new Date('2027-01-01'))).toEqual({ ...draft, hash: oldHash })
  expect(readDraftSnapshot(db, 'r1').reposJson).toBe(oldReposJson)

  git.failure = 'patch-before'
  await expect(publishRun(db, git, 'r1', { writeEnabled: true })).rejects.toThrowError(PublicationError)
  const pending = getRun(db, 'r1')?.pending_commit_sha
  expect(pending).not.toBeNull()
  expect(git.files[0].reposJson).toBe(oldReposJson)
  git.failure = null
  expect(await publishRun(db, git, 'r1', { writeEnabled: true, recover: true })).toBe(pending)
  expect(getRun(db, 'r1')).toMatchObject({ status: 'published', commit_sha: pending, pending_commit_sha: null })
  expect(db.prepare("SELECT COUNT(*) AS count FROM stats WHERE run_id = 'r1'").get()).toEqual({ count: 1 })
})

it('reconciles a visible legacy-format pending commit after a later catalog mutation', async () => {
  const db = fixture()
  const git = new Branch()
  prepareDraft(db, 'r1', timestamp)
  const files = readDraftSnapshot(db, 'r1')
  const oldReposJson = renderRepos(listPublishable(db), { legacyUrls: true })
  const oldHash = createHash('sha256')
    .update(JSON.stringify([files.readme, oldReposJson, files.statsJson, files.markdownPathsJson]), 'utf8')
    .digest('hex')
  db.prepare('UPDATE runs SET draft_hash = ? WHERE run_id = ?').run(oldHash, 'r1')

  db.exec(`CREATE TRIGGER reject_publication BEFORE UPDATE OF published_at ON runs BEGIN SELECT RAISE(ABORT, 'interrupted'); END`)
  await expect(publishRun(db, git, 'r1', { writeEnabled: true })).rejects.toThrowError(PublicationError)
  const pending = getRun(db, 'r1')?.pending_commit_sha
  expect(pending).toBe(git.head)
  expect(git.files[0].reposJson).toBe(oldReposJson)
  expect(JSON.parse(git.files[0].reposJson as string)[0]).not.toHaveProperty('catalog_updated_at')

  db.prepare('UPDATE repositories SET description = ? WHERE id = 18').run('genuinely changed')
  db.exec('DROP TRIGGER reject_publication')
  const before = git.events.length
  expect(await publishRun(db, git, 'r1', { writeEnabled: true, recover: true })).toBe(pending)
  expect(git.events.slice(before)).toEqual([`ANCESTRY ${pending}`])
  expect(db.prepare("SELECT COUNT(*) AS count FROM stats WHERE run_id = 'r1'").get()).toEqual({ count: 1 })
  expect(getRun(db, 'r1')).toMatchObject({ status: 'published', commit_sha: pending, pending_commit_sha: null })
})

it('rejects genuine catalog changes when a persisted draft uses the pre-timestamp serialization', () => {
  const db = fixture()
  const draft = prepareDraft(db, 'r1', timestamp)
  const files = readDraftSnapshot(db, 'r1')
  const oldReposJson = renderRepos(listPublishable(db), { includeCatalogUpdatedAt: false })
  const oldHash = createHash('sha256')
    .update(JSON.stringify([files.readme, oldReposJson, files.statsJson, files.markdownPathsJson]), 'utf8')
    .digest('hex')
  db.prepare('UPDATE runs SET draft_hash = ? WHERE run_id = ?').run(oldHash, 'r1')
  db.prepare('UPDATE repositories SET description = ? WHERE id = 18').run('genuinely changed')

  expect(draft.hash).not.toBe(oldHash)
  expect(() => readDraftSnapshot(db, 'r1')).toThrowError(expect.objectContaining({ category: 'snapshot_changed' }))
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
  expect(draft.hash).toMatch(/^[0-9a-f]{64}$/)
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

it('uploads and verifies release asset before creating and committing release pointer', async () => {
  const db = fixture()
  const git = new Branch()
  const directory = mkdtempSync(join(import.meta.dirname, '.artifact-test-'))
  directories.push(directory)
  const artifactOutputPath = join(directory, 'catalog.sqlite')
  const releasePointerPath = join(directory, 'catalog-release.json')

  prepareDraft(db, 'r1', timestamp, {
    artifactOutputPath,
    releasePointerPath,
  })

  const commit = await publishRun(db, git, 'r1', {
    writeEnabled: true,
    artifactOutputPath,
    releasePointerPath,
  })

  expect(git.head).toBe(commit)
  expect(git.uploadedAssets).toHaveLength(1)
  expect(git.uploadedAssets[0].assetName).toBe('catalog.sqlite')
  expect(existsSync(releasePointerPath)).toBe(true)
  const pointer = JSON.parse(readFileSync(releasePointerPath, 'utf8'))
  expect(pointer.artifactUrl).toContain('releases/download')
  const artifactRow = db.prepare("SELECT state FROM artifact_publications WHERE run_id = 'r1'").get() as { state: string }
  expect(artifactRow.state).toBe('uploaded')
})

it('fails publication if release asset upload fails, marking artifact failed and creating no commit', async () => {
  const db = fixture()
  const git = new Branch()
  const directory = mkdtempSync(join(import.meta.dirname, '.artifact-fail-'))
  directories.push(directory)
  const artifactOutputPath = join(directory, 'catalog.sqlite')
  const releasePointerPath = join(directory, 'catalog-release.json')

  prepareDraft(db, 'r1', timestamp, {
    artifactOutputPath,
    releasePointerPath,
  })

  git.uploadFailure = 'Network error during release asset upload'

  await expect(
    publishRun(db, git, 'r1', {
      writeEnabled: true,
      artifactOutputPath,
      releasePointerPath,
    }),
  ).rejects.toThrowError(PublicationError)

  expect(git.patches).toBe(0)
  const artifactRow = db.prepare("SELECT state, diagnostic_code FROM artifact_publications WHERE run_id = 'r1'").get() as {
    state: string
    diagnostic_code: string
  }
  expect(artifactRow.state).toBe('failed')
  expect(artifactRow.diagnostic_code).toBe('Network error during release asset upload')
})

it('resets a failed publication to prepared and completes publication on retry', async () => {
  const db = fixture()
  const git = new Branch()
  const directory = mkdtempSync(join(import.meta.dirname, '.artifact-retry-'))
  directories.push(directory)
  const artifactOutputPath = join(directory, 'catalog.sqlite')
  const releasePointerPath = join(directory, 'catalog-release.json')

  prepareDraft(db, 'r1', timestamp, {
    artifactOutputPath,
    releasePointerPath,
  })

  git.uploadFailure = 'Temporary connection reset'
  await expect(
    publishRun(db, git, 'r1', {
      writeEnabled: true,
      artifactOutputPath,
      releasePointerPath,
    }),
  ).rejects.toThrowError(PublicationError)

  expect(git.patches).toBe(0)
  expect((db.prepare("SELECT state FROM artifact_publications WHERE run_id = 'r1'").get() as { state: string }).state).toBe('failed')

  // Retry with working upload
  git.uploadFailure = null
  const commit = await publishRun(db, git, 'r1', {
    writeEnabled: true,
    artifactOutputPath,
    releasePointerPath,
  })

  expect(commit).toBe(git.head)
  expect(git.patches).toBe(1)
  expect((db.prepare("SELECT state FROM artifact_publications WHERE run_id = 'r1'").get() as { state: string }).state).toBe('uploaded')
  expect(git.files[0].catalogReleaseJson).toBeDefined()
})

it('refuses to commit when uploadReleaseAsset is not provided on the git client', async () => {
  const db = fixture()
  const git = new Branch()
  git.uploadReleaseAsset = undefined
  const directory = mkdtempSync(join(import.meta.dirname, '.artifact-nouploader-'))
  directories.push(directory)
  const artifactOutputPath = join(directory, 'catalog.sqlite')
  const releasePointerPath = join(directory, 'catalog-release.json')

  prepareDraft(db, 'r1', timestamp, {
    artifactOutputPath,
    releasePointerPath,
  })

  await expect(
    publishRun(db, git, 'r1', {
      writeEnabled: true,
      artifactOutputPath,
      releasePointerPath,
    }),
  ).rejects.toThrowError(PublicationError)

  expect(git.patches).toBe(0)
  expect((db.prepare("SELECT state FROM artifact_publications WHERE run_id = 'r1'").get() as { state: string }).state).toBe('failed')
})

it('recovers after a restart when artifact is already uploaded and pointer file is missing or stale', async () => {
  const db = fixture()
  const git = new Branch()
  const directory = mkdtempSync(join(import.meta.dirname, '.artifact-restart-'))
  directories.push(directory)
  const artifactOutputPath = join(directory, 'catalog.sqlite')
  const releasePointerPath = join(directory, 'catalog-release.json')

  prepareDraft(db, 'r1', timestamp, {
    artifactOutputPath,
    releasePointerPath,
  })

  // Simulate a crash right after release asset upload:
  // publication is marked uploaded, but process crashed and pointer file was deleted or lost on restart
  rmSync(releasePointerPath, { force: true })
  expect(existsSync(releasePointerPath)).toBe(false)

  // publishRun should detect missing pointer, upload/reconstruct it, and complete commit
  const commit = await publishRun(db, git, 'r1', {
    writeEnabled: true,
    artifactOutputPath,
    releasePointerPath,
  })

  expect(commit).toBe(git.head)
  expect(existsSync(releasePointerPath)).toBe(true)

  // Now test with publication.state === 'uploaded' already set, simulating a restart after upload
  // Reset run to completed with pending commit to test recovery with uploaded state
  const db2 = fixture()
  const git2 = new Branch()
  const directory2 = mkdtempSync(join(import.meta.dirname, '.artifact-restart2-'))
  directories.push(directory2)
  const artifactOutputPath2 = join(directory2, 'catalog.sqlite')
  const releasePointerPath2 = join(directory2, 'catalog-release.json')

  prepareDraft(db2, 'r1', timestamp, {
    artifactOutputPath: artifactOutputPath2,
    releasePointerPath: releasePointerPath2,
  })

  // Mock failure during branch update
  git2.failure = 'patch-before'

  // First call uploads asset, writes pointer, but fails during commit/patch
  await expect(
    publishRun(db2, git2, 'r1', {
      writeEnabled: true,
      artifactOutputPath: artifactOutputPath2,
      releasePointerPath: releasePointerPath2,
    }),
  ).rejects.toThrowError(PublicationError)

  git2.failure = null

  // Now publication was marked failed due to git failure: reset to uploaded to simulate restart after successful upload
  db2.prepare("UPDATE artifact_publications SET state = 'uploaded' WHERE run_id = 'r1'").run()

  // Corrupt or delete pointer file in checkout
  rmSync(releasePointerPath2, { force: true })
  expect(existsSync(releasePointerPath2)).toBe(false)

  // Recovery should reconstruct pointer from durable data and complete publication
  const commit2 = await publishRun(db2, git2, 'r1', {
    writeEnabled: true,
    recover: true,
    artifactOutputPath: artifactOutputPath2,
    releasePointerPath: releasePointerPath2,
  })

  expect(commit2).toBe(git2.head)
  expect(existsSync(releasePointerPath2)).toBe(true)
  const restoredPointer = JSON.parse(readFileSync(releasePointerPath2, 'utf8')) as { snapshotId?: string }
  expect(restoredPointer.snapshotId).toBeDefined()
})

it('replaces a stale pointer file from a previous release when recovering or publishing on a restarted checkout', async () => {
  const db = fixture()
  const git = new Branch()
  const directory = mkdtempSync(join(import.meta.dirname, '.artifact-stale-'))
  directories.push(directory)
  const artifactOutputPath = join(directory, 'catalog.sqlite')
  const releasePointerPath = join(directory, 'catalog-release.json')

  prepareDraft(db, 'r1', timestamp, {
    artifactOutputPath,
    releasePointerPath,
  })

  // Write a stale pointer from an older release into checkout before publish
  const stalePointer: CatalogReleasePointer = {
    snapshotId: 'stale-older-snapshot',
    catalogFingerprint: '0000000000000000000000000000000000000000000000000000000000000000',
    artifactSha256: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    recordCount: 1,
    canonicalCount: 1,
    pluginsCount: 1,
    statsCount: 1,
    schemaVersion: 1,
    generatorVersion: '0.1.0',
    createdAt: '2020-01-01T00:00:00.000Z',
    artifactUrl: 'https://github.com/example/repo/releases/download/catalog-stale/catalog.sqlite',
  }
  writeFileSync(releasePointerPath, JSON.stringify(stalePointer, null, 2), 'utf8')

  // Publish should overwrite the stale pointer with the authentic current release pointer
  const commit = await publishRun(db, git, 'r1', {
    writeEnabled: true,
    artifactOutputPath,
    releasePointerPath,
  })

  expect(commit).toBe(git.head)
  const restoredPointer = JSON.parse(readFileSync(releasePointerPath, 'utf8')) as CatalogReleasePointer
  expect(restoredPointer.snapshotId).not.toBe('stale-older-snapshot')
  expect(restoredPointer.catalogFingerprint).not.toBe('0000000000000000000000000000000000000000000000000000000000000000')
  expect(restoredPointer.artifactUrl).toContain(restoredPointer.snapshotId)

  // Verify the row in artifact_publications stored the correct release pointer, NOT the stale one
  const row = db.prepare("SELECT release_pointer, artifact_url FROM artifact_publications WHERE run_id = 'r1'").get() as {
    release_pointer: string
    artifact_url: string
  }
  const persistedPointer = JSON.parse(row.release_pointer) as CatalogReleasePointer
  expect(persistedPointer.snapshotId).toBe(restoredPointer.snapshotId)
  expect(persistedPointer.snapshotId).not.toBe('stale-older-snapshot')

  // Now simulate a restarted checkout with a stale pointer when publication state is already 'uploaded'
  const db2 = fixture()
  const git2 = new Branch()
  const directory2 = mkdtempSync(join(import.meta.dirname, '.artifact-stale2-'))
  directories.push(directory2)
  const artifactOutputPath2 = join(directory2, 'catalog.sqlite')
  const releasePointerPath2 = join(directory2, 'catalog-release.json')

  prepareDraft(db2, 'r1', timestamp, {
    artifactOutputPath: artifactOutputPath2,
    releasePointerPath: releasePointerPath2,
  })

  // Fail git update to leave run in-flight with uploaded artifact
  git2.failure = 'patch-before'
  await expect(
    publishRun(db2, git2, 'r1', {
      writeEnabled: true,
      artifactOutputPath: artifactOutputPath2,
      releasePointerPath: releasePointerPath2,
    }),
  ).rejects.toThrowError(PublicationError)
  git2.failure = null

  // Ensure state is uploaded
  db2.prepare("UPDATE artifact_publications SET state = 'uploaded' WHERE run_id = 'r1'").run()

  // Replace checkout's pointer with stale pointer from another release
  writeFileSync(releasePointerPath2, JSON.stringify(stalePointer, null, 2), 'utf8')

  // Recovery should detect that the pointer file is stale, replace it from durable publication data, and complete commit
  const commit2 = await publishRun(db2, git2, 'r1', {
    writeEnabled: true,
    recover: true,
    artifactOutputPath: artifactOutputPath2,
    releasePointerPath: releasePointerPath2,
  })

  expect(commit2).toBe(git2.head)
  const finalPointer = JSON.parse(readFileSync(releasePointerPath2, 'utf8')) as CatalogReleasePointer
  expect(finalPointer.snapshotId).not.toBe('stale-older-snapshot')
})

it('replaces a pointer with matching identity fields but a stale artifactUrl during recovery', async () => {
  const db = fixture()
  const git = new Branch()
  const directory = mkdtempSync(join(import.meta.dirname, '.artifact-stale-url-'))
  directories.push(directory)
  const artifactOutputPath = join(directory, 'catalog.sqlite')
  const releasePointerPath = join(directory, 'catalog-release.json')

  prepareDraft(db, 'r1', timestamp, {
    artifactOutputPath,
    releasePointerPath,
  })

  // Fail git update to leave run in-flight with uploaded artifact
  git.failure = 'patch-before'
  await expect(
    publishRun(db, git, 'r1', {
      writeEnabled: true,
      artifactOutputPath,
      releasePointerPath,
    }),
  ).rejects.toThrowError(PublicationError)
  git.failure = null

  const validUrl = 'https://github.com/example/repo/releases/download/catalog-authentic/catalog.sqlite'
  db.prepare("UPDATE artifact_publications SET state = 'uploaded', artifact_url = ? WHERE run_id = 'r1'").run(validUrl)

  // Overwrite pointer file with matching identity but stale artifactUrl
  const genuinePointer = JSON.parse(readFileSync(releasePointerPath, 'utf8')) as CatalogReleasePointer
  const staleUrlPointer: CatalogReleasePointer = {
    ...genuinePointer,
    artifactUrl: 'https://github.com/example/repo/releases/download/catalog-stale/catalog.sqlite',
  }
  writeFileSync(releasePointerPath, JSON.stringify(staleUrlPointer, null, 2), 'utf8')

  const commit = await publishRun(db, git, 'r1', {
    writeEnabled: true,
    recover: true,
    artifactOutputPath,
    releasePointerPath,
  })

  expect(commit).toBe(git.head)
  const restoredPointer = JSON.parse(readFileSync(releasePointerPath, 'utf8')) as CatalogReleasePointer
  expect(restoredPointer.artifactUrl).toBe(validUrl)
  expect(restoredPointer.snapshotId).toBe(genuinePointer.snapshotId)
})

it('preserves existing publication and uploaded state when prepareDraft is called again for the same run', async () => {
  const db = fixture()
  const directory = mkdtempSync(join(import.meta.dirname, '.artifact-preserve-'))
  directories.push(directory)
  const artifactOutputPath = join(directory, 'catalog.sqlite')
  const releasePointerPath = join(directory, 'catalog-release.json')

  prepareDraft(db, 'r1', timestamp, {
    artifactOutputPath,
    releasePointerPath,
  })

  const initialPub = getArtifactPublication(db, 'r1')
  expect(initialPub).toBeDefined()
  expect(initialPub?.state).toBe('prepared')

  // Mark uploaded with URL
  const testUrl = 'https://github.com/example/repo/releases/download/test/catalog.sqlite'
  db.prepare("UPDATE artifact_publications SET state = 'uploaded', artifact_url = ? WHERE run_id = 'r1'").run(testUrl)

  // Re-enter prepareDraft with another clock value
  const later = new Date(timestamp.getTime() + 100_000)
  prepareDraft(db, 'r1', later, {
    artifactOutputPath,
    releasePointerPath,
  })

  const postReentryPub = getArtifactPublication(db, 'r1')
  expect(postReentryPub).toBeDefined()
  expect(postReentryPub?.snapshot_id).toBe(initialPub?.snapshot_id)
  expect(postReentryPub?.state).toBe('uploaded')
  expect(postReentryPub?.artifact_url).toBe(testUrl)
})

it('preserves uploaded artifact publication state across git failures and reuses pointer on retry', async () => {
  const db = fixture()
  const git = new Branch()
  const directory = mkdtempSync(join(import.meta.dirname, '.artifact-git-failure-'))
  directories.push(directory)
  const artifactOutputPath = join(directory, 'catalog.sqlite')
  const releasePointerPath = join(directory, 'catalog-release.json')

  prepareDraft(db, 'r1', timestamp, {
    artifactOutputPath,
    releasePointerPath,
  })

  // First publish attempt fails at Git commit step
  git.failure = 'commit-before'
  await expect(
    publishRun(db, git, 'r1', {
      writeEnabled: true,
      artifactOutputPath,
      releasePointerPath,
    }),
  ).rejects.toThrow(PublicationError)

  const pubAfterGitFailure = getArtifactPublication(db, 'r1')
  expect(pubAfterGitFailure).toBeDefined()
  expect(pubAfterGitFailure?.state).toBe('uploaded')
  expect(git.uploadedAssets.length).toBe(1)

  // Repair Git and retry
  git.failure = null
  const commit = await publishRun(db, git, 'r1', {
    writeEnabled: true,
    artifactOutputPath,
    releasePointerPath,
  })

  expect(commit).toBe(git.head)
  expect(git.uploadedAssets.length).toBe(1) // Was NOT re-uploaded!
  const finalPub = getArtifactPublication(db, 'r1')
  expect(finalPub?.snapshot_id).toBe(pubAfterGitFailure?.snapshot_id)
  expect(finalPub?.state).toBe('uploaded')
})

it('refuses publication when artifact paths are missing and legacy publication is disallowed', async () => {
  const db = fixture()
  const git = new Branch()
  prepareDraft(db, 'r1', timestamp)

  await expect(
    publishRun(db, git, 'r1', {
      writeEnabled: true,
      requireArtifactPublication: true,
    }),
  ).rejects.toMatchObject({ category: 'snapshot_invalid' })
})

it('isolates artifact paths between sequential crawler runs so artifacts are not overwritten', async () => {
  const directory = mkdtempSync(join(import.meta.dirname, '.artifact-isolation-'))
  directories.push(directory)
  const paths1 = resolveArtifactPaths(
    { artifactOutputPath: join(directory, 'artifacts/{runId}/catalog.sqlite'), releasePointerPath: join(directory, 'pointer.json') },
    'run-1',
  )
  const paths2 = resolveArtifactPaths(
    { artifactOutputPath: join(directory, 'artifacts/{runId}/catalog.sqlite'), releasePointerPath: join(directory, 'pointer.json') },
    'run-2',
  )

  expect(paths1?.outputPath).toContain('run-1')
  expect(paths2?.outputPath).toContain('run-2')
  expect(paths1?.outputPath).not.toEqual(paths2?.outputPath)
})

it('recovers after restart and complete artifact loss on disk (deterministic regeneration with same SHA)', async () => {
  const db = fixture()
  const git = new Branch()
  const directory = mkdtempSync(join(import.meta.dirname, '.artifact-wipe-'))
  directories.push(directory)
  const artifactOutputPath = join(directory, 'catalog.sqlite')
  const releasePointerPath = join(directory, 'catalog-release.json')

  prepareDraft(db, 'r1', timestamp, {
    artifactOutputPath,
    releasePointerPath,
  })

  // First publication attempt fails during upload
  git.uploadFailure = new Error('Connection reset')
  await expect(
    publishRun(db, git, 'r1', {
      writeEnabled: true,
      artifactOutputPath,
      releasePointerPath,
    }),
  ).rejects.toThrowError(PublicationError)

  const pubRow = db.prepare("SELECT * FROM artifact_publications WHERE run_id = 'r1'").get() as {
    state: string
    artifact_sha256: string
    snapshot_id: string
  }
  expect(pubRow.state).toBe('failed')
  const initialSha = pubRow.artifact_sha256

  // Simulate container restart with wiped ephemeral filesystem:
  // Both SQLite artifact and pointer file are completely removed from disk
  rmSync(artifactOutputPath, { force: true })
  rmSync(releasePointerPath, { force: true })
  expect(existsSync(artifactOutputPath)).toBe(false)
  expect(existsSync(releasePointerPath)).toBe(false)

  // Recovery should regenerate the artifact deterministically with the same SHA, upload it, and succeed
  git.uploadFailure = null
  const commit = await publishRun(db, git, 'r1', {
    writeEnabled: true,
    artifactOutputPath,
    releasePointerPath,
  })

  expect(commit).toBe(git.head)
  expect(existsSync(artifactOutputPath)).toBe(true)
  expect(existsSync(releasePointerPath)).toBe(true)
  const finalPub = db.prepare("SELECT * FROM artifact_publications WHERE run_id = 'r1'").get() as {
    state: string
    artifact_sha256: string
  }
  expect(finalPub.state).toBe('uploaded')
  expect(finalPub.artifact_sha256).toBe(initialSha)
})
