import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { updateEnriched, upsertDiscovery } from '../storage/repositories.js'
import { beginRun, completeRun } from '../storage/runs.js'
import { initializeSchema } from '../storage/schema.js'
import {
  ArtifactPublicationError,
  getArtifactPublication,
  markArtifactFailed,
  markArtifactUploaded,
  prepareArtifactPublication,
  writeReleasePointer,
} from './artifactPublisher.js'

describe('artifactPublisher', () => {
  let tempDir: string
  let db: Database.Database

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'artifact-publisher-test-'))
    db = new Database(':memory:')
    initializeSchema(db)
  })

  afterEach(() => {
    db.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('throws ArtifactPublicationError when run does not exist', () => {
    const outputPath = join(tempDir, 'catalog.sqlite')
    expect(() =>
      prepareArtifactPublication(db, 'non-existent-run', {
        outputPath,
        snapshotId: 'snap-1',
      }),
    ).toThrow(ArtifactPublicationError)
  })

  it('prepares artifact publication and transitions through upload lifecycle', () => {
    // Setup run
    const runId = 'test-run-1'
    beginRun(db, runId, '2026-03-01T00:00:00.000Z')
    completeRun(db, runId, '2026-03-01T00:01:00.000Z', 0)

    // Setup repository
    const id = upsertDiscovery(db, 'https://github.com/test-owner/test-repo', null)
    updateEnriched(
      db,
      id,
      {
        owner: 'test-owner',
        owner_url: 'https://github.com/test-owner',
        repo_name: 'test-repo',
        description: 'Testing publisher',
        stargazers_count: 42,
        forks_count: 7,
        subscribers_count: 3,
        repo_updated: '2026-03-01T00:00:00Z',
        plugins_count: null,
        license: 'MIT',
        archived: 0,
      },
      '2026-03-01T00:00:00.000Z',
    )

    const outputPath = join(tempDir, 'catalog.sqlite')
    const { manifest, publication } = prepareArtifactPublication(db, runId, {
      outputPath,
      snapshotId: 'test-snapshot-pub',
      provenance: { runId },
    })

    expect(manifest.snapshotId).toBe('test-snapshot-pub')
    expect(manifest.recordCount).toBe(1)
    expect(publication.run_id).toBe(runId)
    expect(publication.state).toBe('prepared')
    expect(publication.snapshot_id).toBe('test-snapshot-pub')
    expect(publication.artifact_sha256).toBe(manifest.artifactSha256)
    expect(publication.byte_size).toBeGreaterThan(0)
    expect(publication.artifact_path).toBe(outputPath)
    expect(publication.uploaded_at).toBeNull()

    // Test mark uploaded
    const uploaded = markArtifactUploaded(db, runId, '2026-03-01T00:02:00.000Z')
    expect(uploaded).toBe(true)

    const updatedPub = getArtifactPublication(db, runId)
    expect(updatedPub).not.toBeNull()
    expect(updatedPub?.state).toBe('uploaded')
    expect(updatedPub?.uploaded_at).toBe('2026-03-01T00:02:00.000Z')

    // Test release pointer
    const pointerPath = join(tempDir, 'catalog-release.json')
    const pointer = writeReleasePointer(manifest, pointerPath)
    expect(existsSync(pointerPath)).toBe(true)
    expect(pointer.snapshotId).toBe('test-snapshot-pub')
    expect(pointer.artifactSha256).toBe(manifest.artifactSha256)
    expect(pointer.canonicalCount).toBe(1)

    const readBack = JSON.parse(readFileSync(pointerPath, 'utf8'))
    expect(readBack).toEqual(pointer)
  })

  it('records failure diagnostic code on artifact publication failure', () => {
    const runId = 'failed-run-1'
    const now = new Date().toISOString()
    beginRun(db, runId, now)
    completeRun(db, runId, now, 0)

    const outputPath = join(tempDir, 'catalog.sqlite')
    prepareArtifactPublication(db, runId, {
      outputPath,
      snapshotId: 'snap-fail',
    })

    const failed = markArtifactFailed(db, runId, 'UPLOAD_TIMEOUT')
    expect(failed).toBe(true)

    const pub = getArtifactPublication(db, runId)
    expect(pub).not.toBeNull()
    expect(pub?.state).toBe('failed')
    expect(pub?.diagnostic_code).toBe('UPLOAD_TIMEOUT')
  })
})
