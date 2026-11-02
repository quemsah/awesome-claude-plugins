import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { openPublicCatalog, type SnapshotManifest } from '@awesome-claude-plugins/catalog-snapshot'
import type Database from 'better-sqlite3'
import { type BuildPublicCatalogOptions, buildPublicCatalogFromCrawler } from '../output/publicCatalog.js'
import { getRun } from '../storage/runs.js'

export interface ArtifactPublicationRow {
  run_id: string
  snapshot_id: string
  catalog_fingerprint: string
  artifact_sha256: string
  state: 'prepared' | 'uploaded' | 'failed'
  byte_size: number
  artifact_path: string | null
  diagnostic_code: string | null
  prepared_at: string
  uploaded_at: string | null
  artifact_url?: string | null
  release_pointer?: string | null
}

export interface CatalogReleasePointer {
  snapshotId: string
  catalogFingerprint: string
  artifactSha256: string
  canonicalCount: number
  pluginsCount: number
  statsCount: number
  recordCount: number
  schemaVersion: number
  generatorVersion: string
  createdAt: string
  artifactUrl?: string
}

export class ArtifactPublicationError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'ArtifactPublicationError'
  }
}

export function verifyReleasePointer(pointer: CatalogReleasePointer, manifest: SnapshotManifest): void {
  if (
    pointer.snapshotId !== manifest.snapshotId ||
    pointer.artifactSha256 !== manifest.artifactSha256 ||
    pointer.catalogFingerprint !== manifest.catalogFingerprint ||
    pointer.recordCount !== manifest.recordCount ||
    pointer.canonicalCount !== manifest.canonicalCount ||
    pointer.pluginsCount !== manifest.pluginsCount ||
    pointer.statsCount !== manifest.statsCount
  ) {
    throw new ArtifactPublicationError('Release pointer disagrees with manifest metadata', 'POINTER_MISMATCH')
  }
}

export function getArtifactPublication(db: Database.Database, runId: string): ArtifactPublicationRow | null {
  const row = db.prepare('SELECT * FROM artifact_publications WHERE run_id = ?').get(runId) as ArtifactPublicationRow | undefined
  return row ?? null
}

export function prepareArtifactPublication(
  db: Database.Database,
  runId: string,
  options: BuildPublicCatalogOptions,
): { manifest: SnapshotManifest; publication: ArtifactPublicationRow } {
  const run = getRun(db, runId)
  if (!run) {
    throw new ArtifactPublicationError(`Run not found: ${runId}`, 'RUN_NOT_FOUND')
  }

  const existingPub = getArtifactPublication(db, runId)
  if (existingPub?.state === 'uploaded') {
    if (
      !existingPub.artifact_path ||
      (options.snapshotId && options.snapshotId !== existingPub.snapshot_id) ||
      (options.outputPath && options.outputPath !== existingPub.artifact_path)
    ) {
      throw new ArtifactPublicationError(
        `Cannot re-prepare already uploaded publication with conflicting properties for run ${runId}`,
        'ALREADY_UPLOADED_CONFLICT',
      )
    }
    const artifactPath = existingPub.artifact_path
    const reader = openPublicCatalog(artifactPath)
    try {
      const meta = reader.getCatalogMetadata()
      if (
        existingPub.snapshot_id === meta.snapshot_id &&
        existingPub.catalog_fingerprint === meta.catalog_fingerprint &&
        existingPub.artifact_sha256 === createHash('sha256').update(readFileSync(artifactPath)).digest('hex')
      ) {
        const manifest: SnapshotManifest = {
          schemaVersion: meta.schema_version,
          generatorVersion: meta.generator_version,
          snapshotId: meta.snapshot_id,
          catalogFingerprint: meta.catalog_fingerprint,
          artifactSha256: existingPub.artifact_sha256,
          recordCount: meta.record_count,
          canonicalCount: meta.canonical_count,
          pluginsCount: meta.plugins_count,
          statsCount: meta.stats_count,
          outputPath: artifactPath,
          createdAt: meta.created_at,
        }
        return { manifest, publication: existingPub }
      }
    } finally {
      reader.close()
    }
    throw new ArtifactPublicationError(
      `Cannot re-prepare already uploaded publication with conflicting properties for run ${runId}`,
      'ALREADY_UPLOADED_CONFLICT',
    )
  }

  // Recovery path: if a publication already exists and its artifact is preserved on disk,
  // reuse the exact artifact rather than regenerating divergent bytes
  if (existingPub?.artifact_path && existsSync(existingPub.artifact_path)) {
    const artifactPath = existingPub.artifact_path
    const diskSha = createHash('sha256').update(readFileSync(artifactPath)).digest('hex')
    if (diskSha === existingPub.artifact_sha256) {
      const reader = openPublicCatalog(artifactPath)
      try {
        const meta = reader.getCatalogMetadata()
        const manifest: SnapshotManifest = {
          schemaVersion: meta.schema_version,
          generatorVersion: meta.generator_version,
          snapshotId: meta.snapshot_id,
          catalogFingerprint: meta.catalog_fingerprint,
          artifactSha256: existingPub.artifact_sha256,
          recordCount: meta.record_count,
          canonicalCount: meta.canonical_count,
          pluginsCount: meta.plugins_count,
          statsCount: meta.stats_count,
          outputPath: artifactPath,
          createdAt: meta.created_at,
        }
        if (existingPub.state === 'failed') {
          db.prepare("UPDATE artifact_publications SET state = 'prepared', diagnostic_code = NULL WHERE run_id = ?").run(runId)
          const updated = getArtifactPublication(db, runId)
          if (!updated) {
            throw new ArtifactPublicationError(`Artifact publication disappeared for run ${runId}`, 'PUBLICATION_MISSING')
          }
          return { manifest, publication: updated }
        }
        return { manifest, publication: existingPub }
      } finally {
        reader.close()
      }
    }
  }

  if (existingPub?.state === 'failed') {
    throw new ArtifactPublicationError(
      `Cannot recover failed publication for run ${runId}: preserved artifact missing or corrupt`,
      'RECOVERY_FAILED',
    )
  }

  const effectiveSnapshotId = options.snapshotId ?? existingPub?.snapshot_id
  const manifest = buildPublicCatalogFromCrawler(db, { ...options, snapshotId: effectiveSnapshotId })
  const byteSize = statSync(options.outputPath).size
  const preparedAt = new Date().toISOString()

  if (options.draftStats) {
    const reader = openPublicCatalog(options.outputPath)
    try {
      const history = reader.getStatistics()
      const latest = history.at(-1)
      if (
        !latest ||
        latest.id !== options.draftStats.id ||
        latest.date !== options.draftStats.date ||
        latest.size !== options.draftStats.size
      ) {
        throw new ArtifactPublicationError('Generated SQLite artifact statistics row does not match draft stats', 'STATS_MISMATCH')
      }
    } finally {
      reader.close()
    }
  }

  const initialPointer: CatalogReleasePointer = {
    snapshotId: manifest.snapshotId,
    catalogFingerprint: manifest.catalogFingerprint,
    artifactSha256: manifest.artifactSha256,
    canonicalCount: manifest.canonicalCount,
    pluginsCount: manifest.pluginsCount,
    statsCount: manifest.statsCount,
    recordCount: manifest.recordCount,
    schemaVersion: manifest.schemaVersion,
    generatorVersion: manifest.generatorVersion,
    createdAt: manifest.createdAt,
  }
  const initialPointerJson = JSON.stringify(initialPointer, null, 2)

  const insertSql = `
    INSERT INTO artifact_publications (
      run_id, snapshot_id, catalog_fingerprint, artifact_sha256,
      state, byte_size, artifact_path, diagnostic_code, prepared_at, uploaded_at,
      artifact_url, release_pointer
    ) VALUES (
      @run_id, @snapshot_id, @catalog_fingerprint, @artifact_sha256,
      'prepared', @byte_size, @artifact_path, NULL, @prepared_at, NULL,
      NULL, @release_pointer
    )
    ON CONFLICT(run_id) DO UPDATE SET
      snapshot_id = excluded.snapshot_id,
      catalog_fingerprint = excluded.catalog_fingerprint,
      artifact_sha256 = excluded.artifact_sha256,
      state = excluded.state,
      byte_size = excluded.byte_size,
      artifact_path = excluded.artifact_path,
      diagnostic_code = NULL,
      prepared_at = excluded.prepared_at,
      uploaded_at = NULL,
      artifact_url = NULL,
      release_pointer = excluded.release_pointer
  `

  db.prepare(insertSql).run({
    run_id: runId,
    snapshot_id: manifest.snapshotId,
    catalog_fingerprint: manifest.catalogFingerprint,
    artifact_sha256: manifest.artifactSha256,
    byte_size: byteSize,
    artifact_path: options.outputPath,
    prepared_at: preparedAt,
    release_pointer: initialPointerJson,
  })

  const publication = getArtifactPublication(db, runId)
  if (!publication) {
    throw new ArtifactPublicationError(`Publication record not found after creation: ${runId}`, 'PUBLICATION_MISSING')
  }
  return { manifest, publication }
}

export function markArtifactUploaded(
  db: Database.Database,
  runId: string,
  uploadedAt = new Date().toISOString(),
  details?: { releasePointer?: string; artifactUrl?: string },
): boolean {
  const result = db
    .prepare(
      "UPDATE artifact_publications SET state = 'uploaded', uploaded_at = ?, release_pointer = coalesce(?, release_pointer), artifact_url = coalesce(?, artifact_url) WHERE run_id = ? AND state = 'prepared'",
    )
    .run(uploadedAt, details?.releasePointer ?? null, details?.artifactUrl ?? null, runId)
  return result.changes > 0
}

export function markArtifactFailed(db: Database.Database, runId: string, diagnosticCode: string): boolean {
  const result = db
    .prepare("UPDATE artifact_publications SET state = 'failed', diagnostic_code = ? WHERE run_id = ? AND state != 'uploaded'")
    .run(diagnosticCode, runId)
  return result.changes > 0
}

function writePointerFileAtomically(pointerPath: string, pointerObj: unknown): void {
  mkdirSync(dirname(pointerPath), { recursive: true })
  const tmpPath = `${pointerPath}.tmp.${process.pid}.${Date.now()}`
  writeFileSync(tmpPath, `${JSON.stringify(pointerObj, null, 2)}\n`, 'utf8')
  renameSync(tmpPath, pointerPath)
}

function tryWriteStoredPointer(
  paths: { pointerPath: string; outputPath?: string },
  publication: ArtifactPublicationRow,
  syncDb: (url: string, pointerObj: unknown) => void,
): boolean {
  if (!publication.release_pointer) return false
  try {
    const stored = JSON.parse(publication.release_pointer) as CatalogReleasePointer
    if (
      stored.snapshotId === publication.snapshot_id &&
      stored.catalogFingerprint === publication.catalog_fingerprint &&
      stored.artifactSha256 === publication.artifact_sha256
    ) {
      if (publication.artifact_url && stored.artifactUrl !== publication.artifact_url) {
        stored.artifactUrl = publication.artifact_url
        syncDb(publication.artifact_url, stored)
      }
      writePointerFileAtomically(paths.pointerPath, stored)
      return true
    }
  } catch {}
  return false
}

function tryWriteExistingPointer(
  paths: { pointerPath: string; outputPath?: string },
  publication: ArtifactPublicationRow,
  syncDb: (url: string, pointerObj: unknown) => void,
): boolean {
  if (!existsSync(paths.pointerPath)) return false
  try {
    const existing = JSON.parse(readFileSync(paths.pointerPath, 'utf8')) as CatalogReleasePointer
    const urlMatches = !publication.artifact_url || existing.artifactUrl === publication.artifact_url
    if (
      existing.snapshotId === publication.snapshot_id &&
      existing.catalogFingerprint === publication.catalog_fingerprint &&
      existing.artifactSha256 === publication.artifact_sha256
    ) {
      if (urlMatches) {
        if (existing.artifactUrl && !publication.artifact_url) syncDb(existing.artifactUrl, existing)
        return true
      }
      if (publication.artifact_url) {
        existing.artifactUrl = publication.artifact_url
        writePointerFileAtomically(paths.pointerPath, existing)
        syncDb(publication.artifact_url, existing)
        return true
      }
    }
  } catch {}
  return false
}

function reconstructPointerFromArtifact(
  paths: { pointerPath: string; outputPath?: string },
  publication: ArtifactPublicationRow,
  syncDb: (url: string, pointerObj: unknown) => void,
): void {
  const artifactPath = publication.artifact_path ?? paths.outputPath
  if (!artifactPath || !existsSync(artifactPath)) return
  const reader = openPublicCatalog(artifactPath)
  try {
    const meta = reader.getCatalogMetadata()
    const reconstructed: CatalogReleasePointer = {
      snapshotId: meta.snapshot_id,
      catalogFingerprint: meta.catalog_fingerprint,
      artifactSha256: publication.artifact_sha256,
      recordCount: meta.record_count,
      canonicalCount: meta.canonical_count,
      pluginsCount: meta.plugins_count,
      statsCount: meta.stats_count,
      schemaVersion: meta.schema_version,
      generatorVersion: meta.generator_version,
      createdAt: meta.created_at,
      ...(publication.artifact_url ? { artifactUrl: publication.artifact_url } : {}),
    }
    writePointerFileAtomically(paths.pointerPath, reconstructed)
    if (publication.artifact_url) syncDb(publication.artifact_url, reconstructed)
  } finally {
    reader.close()
  }
}

export function ensureReleasePointerFile(
  paths: { pointerPath: string; outputPath?: string },
  publication: ArtifactPublicationRow,
  db?: Database.Database,
): void {
  const syncDb = (url: string, pointerObj: unknown) => {
    if (db) {
      try {
        db.prepare('UPDATE artifact_publications SET artifact_url = ?, release_pointer = ? WHERE run_id = ?').run(
          url,
          JSON.stringify(pointerObj, null, 2),
          publication.run_id,
        )
      } catch {}
    }
  }

  if (tryWriteStoredPointer(paths, publication, syncDb)) return
  if (tryWriteExistingPointer(paths, publication, syncDb)) return
  reconstructPointerFromArtifact(paths, publication, syncDb)
}

export function writeReleasePointer(manifest: SnapshotManifest, pointerPath: string, artifactUrl?: string): CatalogReleasePointer {
  mkdirSync(dirname(pointerPath), { recursive: true })

  const pointer: CatalogReleasePointer = {
    snapshotId: manifest.snapshotId,
    catalogFingerprint: manifest.catalogFingerprint,
    artifactSha256: manifest.artifactSha256,
    canonicalCount: manifest.canonicalCount,
    pluginsCount: manifest.pluginsCount,
    statsCount: manifest.statsCount,
    recordCount: manifest.recordCount,
    schemaVersion: manifest.schemaVersion,
    generatorVersion: manifest.generatorVersion,
    createdAt: manifest.createdAt,
    ...(artifactUrl ? { artifactUrl } : {}),
  }

  verifyReleasePointer(pointer, manifest)

  const tmpPath = `${pointerPath}.tmp.${process.pid}.${Date.now()}`
  writeFileSync(tmpPath, `${JSON.stringify(pointer, null, 2)}\n`, 'utf8')
  renameSync(tmpPath, pointerPath)

  return pointer
}
