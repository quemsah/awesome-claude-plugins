import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { SnapshotManifest } from '@awesome-claude-plugins/catalog-snapshot'
import type Database from 'better-sqlite3'
import { renderMarkdownPaths, renderRepos, renderStats } from '../output/catalogSnapshot.js'
import { renderReadme } from '../output/readme.js'
import { assertValidStatsDraft, createStatsDraft, type StatsRecord } from '../output/statsDraft.js'
import { SnapshotValidationError, validateSnapshot } from '../output/validate.js'
import { validateReadme } from '../output/validateReadme.js'
import { ShutdownError } from '../shutdown.js'
import { listPublishable, type PublishableRepository } from '../storage/repositories.js'
import {
  claimPublicationLease,
  clearPendingCommit,
  getRun,
  markPublished,
  PublicationLeaseError,
  type RunDraft,
  type RunRow,
  releasePublicationLease,
  saveRunDraft,
  setPendingCommit,
} from '../storage/runs.js'
import {
  type CatalogReleasePointer,
  ensureReleasePointerFile,
  getArtifactPublication,
  markArtifactFailed,
  markArtifactUploaded,
  prepareArtifactPublication,
  writeReleasePointer,
} from './artifactPublisher.js'
import { type GitHubGit, GitHubGitConflictError, GitHubGitHttpError, type GitSnapshotFiles } from './githubGit.js'

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
  | 'terminated'

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

function snapshotHash(files: GitSnapshotFiles, includeMarkdownPaths: boolean): string {
  const contents = [files.readme, files.reposJson ?? '', files.statsJson ?? '']
  if (includeMarkdownPaths && files.markdownPathsJson) contents.push(files.markdownPathsJson)
  return createHash('sha256').update(JSON.stringify(contents), 'utf8').digest('hex')
}

type RenderedSnapshot = { files: GitSnapshotFiles; hash: string; compatibility: { hash: string; files: GitSnapshotFiles }[] }

function filesForDraftHash(savedHash: string, snapshot: RenderedSnapshot): GitSnapshotFiles | null {
  if (savedHash === snapshot.hash) return snapshot.files
  return snapshot.compatibility.find((candidate) => savedHash === candidate.hash)?.files ?? null
}

function renderFiles(
  db: Database.Database,
  draft: StatsRecord,
  repositories: readonly PublishableRepository[] = listPublishable(db),
): RenderedSnapshot {
  checkHistory(historicalStats(db), draft)
  let files: GitSnapshotFiles
  try {
    const publicDraft = { id: draft.id, date: draft.date, size: draft.size }
    const readme = renderReadme(repositories, draft)
    const reposJson = renderRepos(repositories)
    const statsJson = renderStats(db, publicDraft)
    const markdownPathsJson = renderMarkdownPaths(repositories)
    files = {
      readme,
      reposJson,
      statsJson,
      markdownPathsJson,
    }
    validateSnapshot(reposJson, statsJson, { expectedSize: draft.size, requireLatestSize: true })
    validateReadme(readme, repositories, draft)
  } catch (error) {
    if (error instanceof SnapshotValidationError) {
      throw new PublicationError('snapshot_invalid', { count: error.count, paths: error.paths })
    }
    throw new PublicationError('snapshot_invalid')
  }
  // Keep the exact pre-metadata repos.json bytes for drafts saved before this release.
  const preMetadataFiles = { ...files, reposJson: renderRepos(repositories, { includeNewCatalogMetadata: false }) }
  const previousReposFiles = { ...files, reposJson: renderRepos(repositories, { includeCatalogUpdatedAt: false }) }
  const legacyUrlFiles = { ...files, reposJson: renderRepos(repositories, { legacyUrls: true }) }
  return {
    files,
    hash: snapshotHash(files, true),
    compatibility: [
      { hash: snapshotHash(preMetadataFiles, true), files: preMetadataFiles },
      {
        // The immediately preceding main branch published line-separated JSON without timestamps.
        hash: snapshotHash(previousReposFiles, true),
        files: previousReposFiles,
      },
      // Older drafts used a compact single-line JSON array with canonical URL fields.
      { hash: snapshotHash(legacyUrlFiles, true), files: legacyUrlFiles },
      // Some drafts preceded the markdown-paths.json sidecar; preserve the matching
      // exact repos.json bytes for each historical serialization.
      { hash: snapshotHash(files, false), files },
      { hash: snapshotHash(preMetadataFiles, false), files: preMetadataFiles },
      { hash: snapshotHash(previousReposFiles, false), files: previousReposFiles },
      { hash: snapshotHash(legacyUrlFiles, false), files: legacyUrlFiles },
    ],
  }
}

function hasArtifactTable(db: Database.Database): boolean {
  try {
    const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='artifact_publications'").get()
    return Boolean(row)
  } catch {
    return false
  }
}

function resolveArtifactPaths(options?: { artifactOutputPath?: string; releasePointerPath?: string }): {
  outputPath: string
  pointerPath: string
} | null {
  if (options?.artifactOutputPath && options?.releasePointerPath) {
    return { outputPath: options.artifactOutputPath, pointerPath: options.releasePointerPath }
  }
  if (process.env.CATALOG_SQLITE_OUTPUT_PATH && process.env.CATALOG_RELEASE_PATH) {
    return {
      outputPath: process.env.CATALOG_SQLITE_OUTPUT_PATH,
      pointerPath: process.env.CATALOG_RELEASE_PATH,
    }
  }
  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    return null
  }
  const outputPath = resolve(import.meta.dirname, '../../../ui/src/data/catalog.sqlite')
  const pointerPath = resolve(import.meta.dirname, '../../../ui/catalog-release.json')

  if (existsSync(dirname(outputPath)) || existsSync(dirname(pointerPath))) {
    return { outputPath, pointerPath }
  }
  return null
}

/**
 * Pin the date and all four rendered file contents to this completed crawl.
 * Re-entering with another clock value checks the existing draft rather than replacing it.
 */
export function prepareDraft(
  db: Database.Database,
  runId: string,
  now: Date,
  options?: { artifactOutputPath?: string; releasePointerPath?: string },
): RunDraft {
  return databaseResult(() =>
    db.transaction(() => {
      const run = getRun(db, runId)
      if (run?.status !== 'completed' || run.completed_at === null || run.last_error !== null) throw new PublicationError('invalid_run')
      const repositories = listPublishable(db)
      let draft: RunDraft
      if (run.draft_id !== null || run.draft_date !== null || run.draft_size !== null || run.draft_hash !== null) {
        draft = savedDraft(run)
      } else {
        try {
          draft = { ...createStatsDraft(historicalStats(db), repositories.length, now), hash: '' }
        } catch {
          throw new PublicationError('draft_invalid')
        }
      }
      const snapshot = renderFiles(db, draft, repositories)
      if (draft.hash) {
        if (!filesForDraftHash(draft.hash, snapshot)) throw new PublicationError('snapshot_changed')
      } else {
        draft.hash = snapshot.hash
        try {
          saveRunDraft(db, runId, draft)
        } catch {
          throw new PublicationError('database_error')
        }
      }
      if (hasArtifactTable(db)) {
        const paths = resolveArtifactPaths(options)
        if (paths) {
          try {
            const { manifest } = prepareArtifactPublication(db, runId, {
              outputPath: paths.outputPath,
              createdAt: now.toISOString(),
              draftStats: { id: draft.id, date: draft.date, size: draft.size },
            })
            const pointer = writeReleasePointer(manifest, paths.pointerPath)
            snapshot.files.catalogReleaseJson = `${JSON.stringify(pointer, null, 2)}\n`
          } catch (error) {
            markArtifactFailed(db, runId, error instanceof Error ? error.message : String(error))
            throw new PublicationError('snapshot_invalid')
          }
        }
      }
      return draft
    })(),
  )
}

function checkedSnapshot(
  db: Database.Database,
  runId: string,
  options?: { artifactOutputPath?: string; releasePointerPath?: string },
): { draft: RunDraft; files: GitSnapshotFiles; pending: string | null } {
  return databaseResult(() =>
    db.transaction(() => {
      const run = getRun(db, runId)
      if (run?.status !== 'completed' || run.completed_at === null || run.last_error !== null) throw new PublicationError('invalid_run')
      const draft = savedDraft(run)
      const snapshot = renderFiles(db, draft)
      const files = filesForDraftHash(draft.hash, snapshot)
      if (!files) throw new PublicationError('snapshot_changed')
      if (hasArtifactTable(db)) {
        const publication = getArtifactPublication(db, runId)
        const paths = resolveArtifactPaths(options)
        if (publication && publication.state === 'uploaded') {
          if (paths) {
            ensureReleasePointerFile(paths, publication)
          }
          if (paths && existsSync(paths.pointerPath)) {
            const pointerRaw = readFileSync(paths.pointerPath, 'utf8')
            try {
              const pointer = JSON.parse(pointerRaw) as Partial<CatalogReleasePointer>
              if (
                pointer.snapshotId !== publication.snapshot_id ||
                pointer.catalogFingerprint !== publication.catalog_fingerprint ||
                pointer.artifactSha256 !== publication.artifact_sha256
              ) {
                throw new Error('Pointer mismatch')
              }
              files.catalogReleaseJson = pointerRaw
            } catch {
              throw new PublicationError('snapshot_invalid')
            }
          } else {
            throw new PublicationError('snapshot_invalid')
          }
        } else if (paths) {
          throw new PublicationError('snapshot_invalid')
        }
      }
      return { draft, files, pending: run.pending_commit_sha }
    })(),
  )
}

export function readDraftSnapshot(db: Database.Database, runId: string): GitSnapshotFiles {
  return checkedSnapshot(db, runId).files
}

function recordPublication(db: Database.Database, runId: string, draft: RunDraft, sha: string, owner: string, publishedAt: string): void {
  try {
    markPublished(
      db,
      runId,
      {
        date: draft.date,
        size: draft.size,
        commitSha: sha,
        publishedAt,
      },
      owner,
    )
    if (hasArtifactTable(db)) {
      const pub = getArtifactPublication(db, runId)
      if (pub && pub.state === 'prepared') {
        markArtifactUploaded(db, runId, publishedAt)
      }
    }
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

function forgetPending(db: Database.Database, runId: string, sha: string): void {
  try {
    if (!clearPendingCommit(db, runId, sha)) throw new Error('Pending commit changed before Git rejection was recorded')
  } catch {
    throw new PublicationError('database_error')
  }
}

async function reachable(git: GitHubGit, pending: string): Promise<boolean> {
  try {
    return await git.isCommitReachable(pending)
  } catch (error) {
    if (error instanceof PublicationError) throw error
    if (error instanceof ShutdownError) throw new PublicationError('terminated')
    // A failed comparison does not prove the pending commit is absent.
    throw new PublicationError('git_indeterminate')
  }
}

async function update(git: GitHubGit, sha: string): Promise<'updated' | 'conflict' | 'rejected'> {
  try {
    await git.updateBranch(sha)
    return 'updated'
  } catch (error) {
    if (error instanceof PublicationError) throw error
    if (error instanceof ShutdownError) throw new PublicationError('terminated')
    if (error instanceof GitHubGitConflictError) return 'conflict'
    if (error instanceof GitHubGitHttpError && error.status !== null && error.status >= 400 && error.status < 500) return 'rejected'
    // A timeout, malformed success response, network failure, or server error can be ambiguous.
    throw new PublicationError('git_indeterminate')
  }
}

function validatePublication(run: RunRow | null, options: { writeEnabled?: boolean; recover?: boolean }): { run: RunRow; draft: RunDraft } {
  if (options.writeEnabled !== true) throw new PublicationError('write_disabled')
  if (run?.status !== 'completed' || run.completed_at === null || run.last_error !== null) throw new PublicationError('invalid_run')
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
  now: () => Date,
  options?: { artifactOutputPath?: string; releasePointerPath?: string },
): Promise<string | { snapshot: ReturnType<typeof checkedSnapshot> }> {
  if (run.pending_commit_sha && (await reachable(git, run.pending_commit_sha))) {
    recordPublication(db, runId, draft, run.pending_commit_sha, owner, now().toISOString())
    return run.pending_commit_sha
  }
  const snapshot = checkedSnapshot(db, runId, options)
  if (snapshot.pending) {
    if (snapshot.pending !== run.pending_commit_sha) throw new PublicationError('git_indeterminate')
    const result = await update(git, snapshot.pending)
    if (result === 'updated') {
      recordPublication(db, runId, snapshot.draft, snapshot.pending, owner, now().toISOString())
      return snapshot.pending
    }
    forgetPending(db, runId, snapshot.pending)
    if (result === 'rejected') throw new PublicationError('git_error')
    return { snapshot: { ...snapshot, pending: null } }
  }
  return { snapshot }
}

function datasetCommitMessage(draftDate: string): string {
  return `chore(data): refresh dataset ${draftDate.slice(8, 10)}.${draftDate.slice(5, 7)}.${draftDate.slice(0, 4)}`
}

async function createAndPublishSnapshot(
  db: Database.Database,
  git: GitHubGit,
  runId: string,
  owner: string,
  snapshot: ReturnType<typeof checkedSnapshot>,
  now: () => Date,
): Promise<string> {
  let expectedPending = snapshot.pending
  for (let attempt = 0; attempt < 3; attempt++) {
    let commit: string
    try {
      const head = await git.getBranchHead()
      const tree = await git.createTree(head.treeSha, snapshot.files)
      commit = await git.createCommit(tree, head.sha, datasetCommitMessage(snapshot.draft.date))
    } catch (error) {
      if (hasArtifactTable(db) && getArtifactPublication(db, runId)) {
        markArtifactFailed(db, runId, error instanceof Error ? error.message : 'git_error')
      }
      if (error instanceof PublicationError) throw error
      if (error instanceof ShutdownError) throw new PublicationError('terminated')
      throw new PublicationError('git_error')
    }
    rememberPending(db, runId, commit, expectedPending)
    const result = await update(git, commit)
    if (result === 'updated') {
      recordPublication(db, runId, snapshot.draft, commit, owner, now().toISOString())
      return commit
    }
    forgetPending(db, runId, commit)
    expectedPending = null
    if (result === 'rejected') {
      if (hasArtifactTable(db) && getArtifactPublication(db, runId)) {
        markArtifactFailed(db, runId, 'git_rejected')
      }
      throw new PublicationError('git_error')
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
  options: {
    writeEnabled?: boolean
    recover?: boolean
    now?: () => Date
    artifactOutputPath?: string
    releasePointerPath?: string
  } = {},
): Promise<string> {
  const now = options.now ?? (() => new Date())
  const run = databaseResult(() => getRun(db, runId))
  if (run?.status === 'published') {
    return publishedCommit(db, runId)
  }
  const { run: completedRun, draft: prepared } = validatePublication(run, options)
  const owner = randomUUID()
  claimPublishLease(db, runId, owner, options.recover)
  try {
    if (hasArtifactTable(db)) {
      const paths = resolveArtifactPaths(options)
      if (paths) {
        let manifest: SnapshotManifest | undefined
        let publication = getArtifactPublication(db, runId)
        if (!publication || publication.state === 'failed') {
          try {
            const preparedArtifact = prepareArtifactPublication(db, runId, {
              outputPath: paths.outputPath,
              createdAt: now().toISOString(),
              draftStats: { id: prepared.id, date: prepared.date, size: prepared.size },
            })
            manifest = preparedArtifact.manifest
            publication = preparedArtifact.publication
          } catch (error) {
            markArtifactFailed(db, runId, error instanceof Error ? error.message : String(error))
            throw new PublicationError('snapshot_invalid')
          }
        }

        const artifactPath = publication?.artifact_path ?? paths.outputPath
        if (publication && publication.state !== 'uploaded') {
          if (!git.uploadReleaseAsset) {
            markArtifactFailed(db, runId, 'release_asset_uploader_missing')
            throw new PublicationError('snapshot_invalid')
          }
          const tagName = `catalog-${publication.snapshot_id}`
          const assetName = 'catalog.sqlite'
          try {
            const uploaded = await git.uploadReleaseAsset(tagName, assetName, artifactPath)
            if (uploaded.sha256 !== publication.artifact_sha256) {
              throw new Error(`Uploaded asset SHA-256 mismatch: expected ${publication.artifact_sha256}, got ${uploaded.sha256}`)
            }
            let pointer: CatalogReleasePointer
            if (manifest) {
              pointer = writeReleasePointer(manifest, paths.pointerPath, uploaded.downloadUrl)
            } else {
              ensureReleasePointerFile(paths, publication)
              if (!existsSync(paths.pointerPath)) {
                throw new Error('Release pointer could not be reconstructed from durable publication')
              }
              pointer = JSON.parse(readFileSync(paths.pointerPath, 'utf8')) as CatalogReleasePointer
              pointer.artifactUrl = uploaded.downloadUrl
              writeFileSync(paths.pointerPath, `${JSON.stringify(pointer, null, 2)}\n`, 'utf8')
            }
            if (
              pointer.snapshotId !== publication.snapshot_id ||
              pointer.catalogFingerprint !== publication.catalog_fingerprint ||
              pointer.artifactSha256 !== publication.artifact_sha256
            ) {
              throw new Error(`Release pointer mismatch for publication ${publication.snapshot_id}: pointer=${pointer.snapshotId}`)
            }
            markArtifactUploaded(db, runId, now().toISOString(), {
              releasePointer: JSON.stringify(pointer, null, 2),
              artifactUrl: uploaded.downloadUrl,
            })
          } catch (error) {
            markArtifactFailed(db, runId, error instanceof Error ? error.message : 'upload_failed')
            throw new PublicationError('snapshot_invalid')
          }
        }

        const finalPublication = getArtifactPublication(db, runId)
        if (finalPublication?.state !== 'uploaded') {
          throw new PublicationError('snapshot_invalid')
        }
        ensureReleasePointerFile(paths, finalPublication)
        if (!existsSync(paths.pointerPath)) {
          throw new PublicationError('snapshot_invalid')
        }
        try {
          const pointer = JSON.parse(readFileSync(paths.pointerPath, 'utf8')) as Partial<CatalogReleasePointer>
          if (
            pointer.snapshotId !== finalPublication.snapshot_id ||
            pointer.catalogFingerprint !== finalPublication.catalog_fingerprint ||
            pointer.artifactSha256 !== finalPublication.artifact_sha256 ||
            (finalPublication.artifact_url && pointer.artifactUrl !== finalPublication.artifact_url)
          ) {
            throw new Error('Pointer mismatch')
          }
        } catch {
          throw new PublicationError('snapshot_invalid')
        }
      }
    }
    const pending = await resumePendingCommit(db, git, runId, completedRun, prepared, owner, now, options)
    if (typeof pending === 'string') return pending
    return await createAndPublishSnapshot(db, git, runId, owner, pending.snapshot, now)
  } finally {
    // Once a candidate SHA exists, retain the lease until its Git visibility is reconciled.
    releaseUnpublishedLease(db, runId, owner)
  }
}
