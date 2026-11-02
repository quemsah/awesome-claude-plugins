import { mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
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

  const manifest = buildPublicCatalogFromCrawler(db, options)
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

  const insertSql = `
    INSERT INTO artifact_publications (
      run_id, snapshot_id, catalog_fingerprint, artifact_sha256,
      state, byte_size, artifact_path, diagnostic_code, prepared_at, uploaded_at
    ) VALUES (
      @run_id, @snapshot_id, @catalog_fingerprint, @artifact_sha256,
      'prepared', @byte_size, @artifact_path, NULL, @prepared_at, NULL
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
      uploaded_at = NULL
  `

  db.prepare(insertSql).run({
    run_id: runId,
    snapshot_id: manifest.snapshotId,
    catalog_fingerprint: manifest.catalogFingerprint,
    artifact_sha256: manifest.artifactSha256,
    byte_size: byteSize,
    artifact_path: options.outputPath,
    prepared_at: preparedAt,
  })

  const publication = getArtifactPublication(db, runId)
  if (!publication) {
    throw new ArtifactPublicationError(`Publication record not found after creation: ${runId}`, 'PUBLICATION_MISSING')
  }
  return { manifest, publication }
}

export function markArtifactUploaded(db: Database.Database, runId: string, uploadedAt = new Date().toISOString()): boolean {
  const result = db
    .prepare("UPDATE artifact_publications SET state = 'uploaded', uploaded_at = ? WHERE run_id = ? AND state = 'prepared'")
    .run(uploadedAt, runId)
  return result.changes > 0
}

export function markArtifactFailed(db: Database.Database, runId: string, diagnosticCode: string): boolean {
  const result = db
    .prepare("UPDATE artifact_publications SET state = 'failed', diagnostic_code = ? WHERE run_id = ?")
    .run(diagnosticCode, runId)
  return result.changes > 0
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
