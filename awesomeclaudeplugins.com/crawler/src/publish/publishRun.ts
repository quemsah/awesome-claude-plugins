import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { calculateCatalogFingerprint, type SnapshotManifest } from '@awesome-claude-plugins/catalog-snapshot'
import type Database from 'better-sqlite3'
import { formatPublicCatalogRecord, renderMarkdownPaths, renderRepos, renderStats } from '../output/catalogSnapshot.js'
import { getHistoricalStats } from '../output/publicCatalog.js'
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
  type ArtifactPublicationRow,
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

function snapshotHash(
  files: GitSnapshotFiles,
  includeMarkdownPaths: boolean,
  draft?: { id: number; date: string; size: number },
  catalogFingerprint?: string,
): string {
  if (!files.reposJson && draft) {
    return createHash('sha256')
      .update(JSON.stringify([files.readme, 'sqlite-catalog', draft.id, draft.date, draft.size, catalogFingerprint ?? '']), 'utf8')
      .digest('hex')
  }
  const contents = [files.readme, files.reposJson ?? '', files.statsJson ?? '']
  if (includeMarkdownPaths && files.markdownPathsJson) contents.push(files.markdownPathsJson)
  return createHash('sha256').update(JSON.stringify(contents), 'utf8').digest('hex')
}

type RenderedSnapshot = {
  files: GitSnapshotFiles
  hash: string
  getCompatibility: () => { hash: string; files: GitSnapshotFiles }[]
}

function filesForDraftHash(savedHash: string, snapshot: RenderedSnapshot): GitSnapshotFiles | null {
  if (savedHash === snapshot.hash) return snapshot.files
  return snapshot.getCompatibility().find((candidate) => savedHash === candidate.hash)?.files ?? null
}

function getHistoricalRecoverySnapshots(
  db: Database.Database,
  draft: StatsRecord,
  repositories: readonly PublishableRepository[],
  readme: string,
): { hash: string; files: GitSnapshotFiles }[] {
  const publicDraft = { id: draft.id, date: draft.date, size: draft.size }
  const legacyJson = renderRepos(repositories)
  const legacyStats = renderStats(db, publicDraft)
  const legacyMarkdown = renderMarkdownPaths(repositories)
  const baseFiles: GitSnapshotFiles = {
    readme,
    reposJson: legacyJson,
    statsJson: legacyStats,
    markdownPathsJson: legacyMarkdown,
  }
  const preMetadataFiles = { ...baseFiles, reposJson: renderRepos(repositories, { includeNewCatalogMetadata: false }) }
  const previousReposFiles = { ...baseFiles, reposJson: renderRepos(repositories, { includeCatalogUpdatedAt: false }) }
  const legacyUrlFiles = { ...baseFiles, reposJson: renderRepos(repositories, { legacyUrls: true }) }
  const legacySqliteWithoutFingerprint: GitSnapshotFiles = { readme }
  return [
    { hash: snapshotHash(legacySqliteWithoutFingerprint, true, publicDraft), files: legacySqliteWithoutFingerprint },
    { hash: snapshotHash(preMetadataFiles, true), files: preMetadataFiles },
    { hash: snapshotHash(previousReposFiles, true), files: previousReposFiles },
    { hash: snapshotHash(legacyUrlFiles, true), files: legacyUrlFiles },
    { hash: snapshotHash(baseFiles, false), files: baseFiles },
    { hash: snapshotHash(preMetadataFiles, false), files: preMetadataFiles },
    { hash: snapshotHash(previousReposFiles, false), files: previousReposFiles },
    { hash: snapshotHash(legacyUrlFiles, false), files: legacyUrlFiles },
    { hash: snapshotHash(baseFiles, true), files: baseFiles },
  ]
}

function renderFiles(
  db: Database.Database,
  draft: StatsRecord,
  repositories: readonly PublishableRepository[] = listPublishable(db),
  options?: {
    allowLegacyJsonPublication?: boolean
    paths?: { outputPath: string; pointerPath: string } | null
    catalogFingerprint?: string
  },
): RenderedSnapshot {
  checkHistory(getHistoricalStats(db), draft)
  const publicDraft = { id: draft.id, date: draft.date, size: draft.size }
  let files: GitSnapshotFiles
  try {
    const readme = renderReadme(repositories, draft)
    validateReadme(readme, repositories, draft)

    const shouldRenderLegacyJson = options?.allowLegacyJsonPublication ?? options?.paths === null
    let reposJson: string | undefined
    let statsJson: string | undefined
    let markdownPathsJson: string | undefined

    if (shouldRenderLegacyJson) {
      reposJson = renderRepos(repositories)
      statsJson = renderStats(db, publicDraft)
      markdownPathsJson = renderMarkdownPaths(repositories)
      validateSnapshot(reposJson, statsJson, { expectedSize: draft.size, requireLatestSize: true })
    }

    files = {
      readme,
      ...(reposJson !== undefined ? { reposJson } : {}),
      ...(statsJson !== undefined ? { statsJson } : {}),
      ...(markdownPathsJson !== undefined ? { markdownPathsJson } : {}),
    }
  } catch (error) {
    if (error instanceof SnapshotValidationError) {
      throw new PublicationError('snapshot_invalid', { count: error.count, paths: error.paths })
    }
    throw new PublicationError('snapshot_invalid')
  }

  const catalogFingerprint =
    options?.catalogFingerprint ?? calculateCatalogFingerprint(repositories.map((r) => formatPublicCatalogRecord(r)))

  return {
    files,
    hash: snapshotHash(files, true, publicDraft, catalogFingerprint),
    getCompatibility: () => getHistoricalRecoverySnapshots(db, draft, repositories, files.readme),
  }
}

export function hasArtifactTable(db: Database.Database): boolean {
  try {
    const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='artifact_publications'").get()
    return Boolean(row)
  } catch {
    return false
  }
}

function formatTemplate(template: string, runId?: string): string {
  return runId ? template.replaceAll('{runId}', runId) : template
}

function resolveDefaultPaths(runId?: string): { outputPath: string; pointerPath: string } {
  const pointerPath = resolve(import.meta.dirname, '../../../ui/catalog-release.json')
  if (existsSync('/data')) {
    const outputPath = runId ? `/data/catalog-artifacts/${runId}/catalog.sqlite` : '/data/catalog-artifacts/catalog.sqlite'
    return { outputPath, pointerPath }
  }
  const defaultDir = resolve(import.meta.dirname, '../../../ui/src/data')
  const outputPath = runId ? resolve(defaultDir, `artifacts/${runId}/catalog.sqlite`) : resolve(defaultDir, 'catalog.sqlite')
  return { outputPath, pointerPath }
}

export function resolveArtifactPaths(
  options?: { artifactOutputPath?: string; releasePointerPath?: string },
  runId?: string,
): {
  outputPath: string
  pointerPath: string
} | null {
  if (options?.artifactOutputPath && options?.releasePointerPath) {
    return {
      outputPath: formatTemplate(options.artifactOutputPath, runId),
      pointerPath: formatTemplate(options.releasePointerPath, runId),
    }
  }

  const defaultPaths = resolveDefaultPaths(runId)
  if (process.env.CATALOG_SQLITE_OUTPUT_PATH || process.env.CATALOG_RELEASE_PATH) {
    const rawOutput = process.env.CATALOG_SQLITE_OUTPUT_PATH
    let outputPath: string
    if (rawOutput) {
      if (runId && !rawOutput.includes('{runId}')) {
        outputPath = join(dirname(rawOutput), runId, basename(rawOutput))
      } else {
        outputPath = formatTemplate(rawOutput, runId)
      }
    } else {
      outputPath = defaultPaths.outputPath
    }
    return {
      outputPath,
      pointerPath: process.env.CATALOG_RELEASE_PATH ? formatTemplate(process.env.CATALOG_RELEASE_PATH, runId) : defaultPaths.pointerPath,
    }
  }

  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    return null
  }

  if (existsSync('/data')) {
    return defaultPaths
  }

  const defaultDir = resolve(import.meta.dirname, '../../../ui/src/data')
  if (existsSync(dirname(defaultPaths.outputPath)) || existsSync(dirname(defaultPaths.pointerPath)) || existsSync(defaultDir)) {
    return defaultPaths
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
  options?: { artifactOutputPath?: string; releasePointerPath?: string; allowLegacyJsonPublication?: boolean },
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
          draft = { ...createStatsDraft(getHistoricalStats(db), repositories.length, now), hash: '' }
        } catch {
          throw new PublicationError('draft_invalid')
        }
      }
      const paths = resolveArtifactPaths(options, runId)
      const snapshot = renderFiles(db, draft, repositories, { ...options, paths })
      if (hasArtifactTable(db)) {
        attachArtifactToDraft(db, runId, now, draft, snapshot, options)
      }
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
      return draft
    })(),
  )
}

function attachArtifactToDraft(
  db: Database.Database,
  runId: string,
  now: Date,
  draft: RunDraft,
  snapshot: RenderedSnapshot,
  options?: { artifactOutputPath?: string; releasePointerPath?: string },
): void {
  const paths = resolveArtifactPaths(options, runId)
  if (!paths) return
  try {
    const existingPub = getArtifactPublication(db, runId)
    let preserved = false
    if (existingPub && (existingPub.state === 'prepared' || existingPub.state === 'uploaded')) {
      ensureReleasePointerFile(paths, existingPub, db)
      if (existsSync(paths.pointerPath)) {
        try {
          const pointerRaw = readFileSync(paths.pointerPath, 'utf8')
          const pointer = JSON.parse(pointerRaw) as Partial<CatalogReleasePointer>
          if (
            pointer.snapshotId === existingPub.snapshot_id &&
            pointer.catalogFingerprint === existingPub.catalog_fingerprint &&
            pointer.artifactSha256 === existingPub.artifact_sha256
          ) {
            snapshot.files.catalogReleaseJson = pointerRaw
            preserved = true
          }
        } catch (_err) {
          /* ignore malformed pointer */
        }
      }
    }
    if (!preserved) {
      const run = getRun(db, runId)
      const createdAt = existingPub?.prepared_at ?? run?.completed_at ?? now.toISOString()
      const { manifest } = prepareArtifactPublication(db, runId, {
        outputPath: paths.outputPath,
        createdAt,
        draftStats: { id: draft.id, date: draft.date, size: draft.size },
      })
      const pointer = writeReleasePointer(manifest, paths.pointerPath)
      snapshot.files.catalogReleaseJson = `${JSON.stringify(pointer, null, 2)}\n`
    }
  } catch (error) {
    markArtifactFailed(db, runId, error instanceof Error ? error.message : String(error))
    throw new PublicationError('snapshot_invalid')
  }
}

function isPublicationReady(publication: ArtifactPublicationRow | null): publication is ArtifactPublicationRow {
  if (!publication) return false
  return publication.state === 'uploaded' || publication.state === 'prepared'
}

function readCheckedPointerRaw(
  paths: { outputPath: string; pointerPath: string } | null,
  publication: ArtifactPublicationRow,
): string | null {
  if (paths) {
    ensureReleasePointerFile(paths, publication)
    if (existsSync(paths.pointerPath)) return readFileSync(paths.pointerPath, 'utf8')
  }
  return publication.release_pointer ?? null
}

function validatePointerMatchesPublication(pointerRaw: string, publication: ArtifactPublicationRow): void {
  try {
    const pointer = JSON.parse(pointerRaw) as Partial<CatalogReleasePointer>
    const matches =
      pointer.snapshotId === publication.snapshot_id &&
      pointer.catalogFingerprint === publication.catalog_fingerprint &&
      pointer.artifactSha256 === publication.artifact_sha256
    if (!matches) throw new Error('Pointer mismatch')
  } catch {
    throw new PublicationError('snapshot_invalid')
  }
}

function resolveCheckedReleasePointer(
  db: Database.Database,
  runId: string,
  options?: { artifactOutputPath?: string; releasePointerPath?: string },
  currentFingerprint?: string,
): string | null {
  if (!hasArtifactTable(db)) return null
  const publication = getArtifactPublication(db, runId)
  const paths = resolveArtifactPaths(options, runId)
  if (!isPublicationReady(publication)) {
    if (paths) throw new PublicationError('snapshot_invalid')
    return null
  }
  if (currentFingerprint && publication.catalog_fingerprint !== currentFingerprint) {
    throw new PublicationError('snapshot_changed')
  }
  const pointerRaw = readCheckedPointerRaw(paths, publication)
  if (!pointerRaw) {
    if (paths) throw new PublicationError('snapshot_invalid')
    return null
  }
  validatePointerMatchesPublication(pointerRaw, publication)
  return pointerRaw
}

function precheckPublicationDraft(
  db: Database.Database,
  runId: string,
  draft: RunDraft,
  options?: { artifactOutputPath?: string; releasePointerPath?: string; allowLegacyJsonPublication?: boolean },
): void {
  databaseResult(() =>
    db.transaction(() => {
      const publishable = listPublishable(db)
      const currentFingerprint = calculateCatalogFingerprint(publishable.map((r) => formatPublicCatalogRecord(r)))
      const paths = resolveArtifactPaths(options, runId)
      const snapshot = renderFiles(db, draft, publishable, { ...options, paths, catalogFingerprint: currentFingerprint })
      if (!filesForDraftHash(draft.hash, snapshot)) {
        throw new PublicationError('snapshot_changed')
      }
      if (hasArtifactTable(db)) {
        const publication = getArtifactPublication(db, runId)
        if (publication?.catalog_fingerprint && publication.catalog_fingerprint !== currentFingerprint) {
          throw new PublicationError('snapshot_changed')
        }
      }
    })(),
  )
}

function checkedSnapshot(
  db: Database.Database,
  runId: string,
  options?: { artifactOutputPath?: string; releasePointerPath?: string; allowLegacyJsonPublication?: boolean },
): { draft: RunDraft; files: GitSnapshotFiles; pending: string | null } {
  return databaseResult(() =>
    db.transaction(() => {
      const run = getRun(db, runId)
      if (run?.status !== 'completed' || run.completed_at === null || run.last_error !== null) throw new PublicationError('invalid_run')
      const draft = savedDraft(run)
      const publishable = listPublishable(db)
      const currentFingerprint = calculateCatalogFingerprint(publishable.map((r) => formatPublicCatalogRecord(r)))
      const paths = resolveArtifactPaths(options, runId)
      const snapshot = renderFiles(db, draft, publishable, { ...options, paths, catalogFingerprint: currentFingerprint })
      const releasePointer = resolveCheckedReleasePointer(db, runId, options, currentFingerprint)
      if (releasePointer) snapshot.files.catalogReleaseJson = releasePointer
      const files = filesForDraftHash(draft.hash, snapshot)
      if (!files) throw new PublicationError('snapshot_changed')
      if (releasePointer) files.catalogReleaseJson = releasePointer
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

function verifyFinalPublication(
  paths: { outputPath: string; pointerPath: string },
  finalPublication: NonNullable<ReturnType<typeof getArtifactPublication>>,
  db: Database.Database,
): void {
  if (finalPublication.state !== 'uploaded') {
    throw new PublicationError('snapshot_invalid')
  }
  ensureReleasePointerFile(paths, finalPublication, db)
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

async function uploadPublicationAsset(
  db: Database.Database,
  git: GitHubGit,
  runId: string,
  paths: { outputPath: string; pointerPath: string },
  publication: NonNullable<ReturnType<typeof getArtifactPublication>>,
  manifest: SnapshotManifest | undefined,
  now: () => Date,
): Promise<void> {
  if (!git.uploadReleaseAsset) {
    markArtifactFailed(db, runId, 'release_asset_uploader_missing')
    throw new PublicationError('snapshot_invalid')
  }
  const tagName = `catalog-${publication.snapshot_id}`
  const assetName = 'catalog.sqlite'
  const artifactPath = publication.artifact_path ?? paths.outputPath
  try {
    const uploaded = await git.uploadReleaseAsset(tagName, assetName, artifactPath)
    if (uploaded.sha256 !== publication.artifact_sha256) {
      throw new Error(`Uploaded asset SHA-256 mismatch: expected ${publication.artifact_sha256}, got ${uploaded.sha256}`)
    }
    const extraMetadata = {
      releaseId: uploaded.releaseId,
      assetId: uploaded.assetId,
      byteSize: uploaded.size ?? publication.byte_size,
      sourceProvenance: `github-release:${tagName}/${assetName}`,
    }
    let pointer: CatalogReleasePointer
    if (manifest) {
      pointer = writeReleasePointer(manifest, paths.pointerPath, uploaded.downloadUrl, extraMetadata)
    } else {
      ensureReleasePointerFile(paths, publication, db)
      if (!existsSync(paths.pointerPath)) {
        throw new Error('Release pointer could not be reconstructed from durable publication')
      }
      pointer = JSON.parse(readFileSync(paths.pointerPath, 'utf8')) as CatalogReleasePointer
      pointer.artifactUrl = uploaded.downloadUrl
      if (uploaded.releaseId) pointer.releaseId = uploaded.releaseId
      if (uploaded.assetId) pointer.assetId = uploaded.assetId
      if (uploaded.size) pointer.byteSize = uploaded.size
      pointer.sourceProvenance = `github-release:${tagName}/${assetName}`
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

function validateArtifactRequirement(
  paths: { outputPath: string; pointerPath: string } | null,
  options: { allowLegacyJsonPublication?: boolean; requireArtifactPublication?: boolean },
): void {
  const isTestEnv = Boolean(process.env.VITEST || process.env.NODE_ENV === 'test')
  const requireArtifact = options.requireArtifactPublication ?? (!isTestEnv && !options.allowLegacyJsonPublication)
  if (!paths && requireArtifact) {
    throw new PublicationError('snapshot_invalid')
  }
}

function ensurePreparedPublication(
  db: Database.Database,
  runId: string,
  paths: { outputPath: string; pointerPath: string },
  prepared: RunDraft,
  existing: ArtifactPublicationRow | null | undefined,
  now: () => Date,
): { publication: ArtifactPublicationRow; manifest?: SnapshotManifest } {
  const artifactMissing = !existing?.artifact_path || !existsSync(existing.artifact_path)
  if (existing && existing.state !== 'failed' && !artifactMissing) {
    return { publication: existing }
  }

  try {
    const run = getRun(db, runId)
    const createdAt = existing?.prepared_at ?? run?.completed_at ?? now().toISOString()
    const preparedArtifact = prepareArtifactPublication(db, runId, {
      outputPath: paths.outputPath,
      createdAt,
      draftStats: { id: prepared.id, date: prepared.date, size: prepared.size },
    })
    return { publication: preparedArtifact.publication, manifest: preparedArtifact.manifest }
  } catch (error) {
    markArtifactFailed(db, runId, error instanceof Error ? error.message : String(error))
    throw new PublicationError('snapshot_invalid')
  }
}

async function publishArtifactRelease(
  db: Database.Database,
  git: GitHubGit,
  runId: string,
  prepared: RunDraft,
  options: {
    artifactOutputPath?: string
    releasePointerPath?: string
    allowLegacyJsonPublication?: boolean
    requireArtifactPublication?: boolean
  },
  now: () => Date,
): Promise<void> {
  if (!hasArtifactTable(db)) return
  const paths = resolveArtifactPaths(options, runId)
  validateArtifactRequirement(paths, options)
  if (!paths) return

  const existing = getArtifactPublication(db, runId)
  const { publication, manifest } = ensurePreparedPublication(db, runId, paths, prepared, existing, now)

  if (publication.state !== 'uploaded') {
    precheckPublicationDraft(db, runId, prepared, options)
    await uploadPublicationAsset(db, git, runId, paths, publication, manifest, now)
  }

  const finalPublication = getArtifactPublication(db, runId)
  if (!finalPublication) throw new PublicationError('snapshot_invalid')
  verifyFinalPublication(paths, finalPublication, db)
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
    allowLegacyJsonPublication?: boolean
    requireArtifactPublication?: boolean
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
    await publishArtifactRelease(db, git, runId, prepared, options, now)
    const pending = await resumePendingCommit(db, git, runId, completedRun, prepared, owner, now, options)
    if (typeof pending === 'string') return pending
    return await createAndPublishSnapshot(db, git, runId, owner, pending.snapshot, now)
  } finally {
    // Once a candidate SHA exists, retain the lease until its Git visibility is reconciled.
    releaseUnpublishedLease(db, runId, owner)
  }
}
