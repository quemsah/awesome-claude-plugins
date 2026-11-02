import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  it('refuses to transition an uploaded publication to failed', () => {
    const runId = 'test-upload-guard'
    const now = new Date().toISOString()
    beginRun(db, runId, now)
    completeRun(db, runId, now, 0)

    const outputPath = join(tempDir, 'catalog.sqlite')
    prepareArtifactPublication(db, runId, {
      outputPath,
      snapshotId: 'snap-guard',
    })
    markArtifactUploaded(db, runId, now, { artifactUrl: 'https://example.com/asset', releasePointer: '{}' })

    const failed = markArtifactFailed(db, runId, 'LATE_GIT_ERROR')
    expect(failed).toBe(false)

    const pub = getArtifactPublication(db, runId)
    expect(pub?.state).toBe('uploaded')
  })

  it('rejects re-preparing an uploaded publication with conflicting properties', () => {
    const runId = 'test-reprepare-conflict'
    const now = new Date().toISOString()
    beginRun(db, runId, now)
    completeRun(db, runId, now, 0)

    const outputPath = join(tempDir, 'catalog.sqlite')
    prepareArtifactPublication(db, runId, {
      outputPath,
      snapshotId: 'snap-orig',
    })
    markArtifactUploaded(db, runId, now, { artifactUrl: 'https://example.com/asset', releasePointer: '{}' })

    const otherOutputPath = join(tempDir, 'other-catalog.sqlite')
    expect(() =>
      prepareArtifactPublication(db, runId, {
        outputPath: otherOutputPath,
        snapshotId: 'snap-diff',
      }),
    ).toThrow('Cannot re-prepare already uploaded publication')
  })

  it('safely returns existing publication when re-preparing an uploaded publication with identical properties', () => {
    const runId = 'test-reprepare-identical'
    const now = new Date().toISOString()
    beginRun(db, runId, now)
    completeRun(db, runId, now, 0)

    const outputPath = join(tempDir, 'catalog.sqlite')
    prepareArtifactPublication(db, runId, {
      outputPath,
      snapshotId: 'snap-same',
    })
    markArtifactUploaded(db, runId, now, { artifactUrl: 'https://example.com/asset', releasePointer: '{}' })

    const second = prepareArtifactPublication(db, runId, {
      outputPath,
      snapshotId: 'snap-same',
    })
    expect(second.publication.state).toBe('uploaded')
    expect(second.publication.snapshot_id).toBe('snap-same')
  })

  it('recovers a failed publication using preserved artifact on disk without mutating snapshot ID', () => {
    const runId = 'test-recovery-success'
    const now = new Date().toISOString()
    beginRun(db, runId, now)
    completeRun(db, runId, now, 0)

    const outputPath = join(tempDir, 'catalog-recovery.sqlite')
    const first = prepareArtifactPublication(db, runId, {
      outputPath,
      snapshotId: 'snap-recover-1',
    })
    expect(first.publication.state).toBe('prepared')

    // Simulate failure during upload
    markArtifactFailed(db, runId, 'NETWORK_DROP')
    expect(getArtifactPublication(db, runId)?.state).toBe('failed')

    // Re-prepare should recover preserved artifact and revert state to prepared
    const recovered = prepareArtifactPublication(db, runId, { outputPath })
    expect(recovered.publication.state).toBe('prepared')
    expect(recovered.publication.snapshot_id).toBe('snap-recover-1')
    expect(recovered.manifest.snapshotId).toBe('snap-recover-1')
    expect(recovered.manifest.artifactSha256).toBe(first.manifest.artifactSha256)
  })

  it('rejects recovery of a failed publication when preserved artifact is missing or corrupted', () => {
    const runId = 'test-recovery-corrupt'
    const now = new Date().toISOString()
    beginRun(db, runId, now)
    completeRun(db, runId, now, 0)

    const outputPath = join(tempDir, 'catalog-corrupt.sqlite')
    prepareArtifactPublication(db, runId, {
      outputPath,
      snapshotId: 'snap-corrupt-1',
    })
    markArtifactFailed(db, runId, 'CRASH')

    // Corrupt artifact
    writeFileSync(outputPath, 'corrupted content')

    expect(() => prepareArtifactPublication(db, runId, { outputPath })).toThrow('Cannot recover failed publication')
  })
})
