import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import { buildPublicCatalog, GENERATOR_VERSION, SCHEMA_VERSION } from '@awesome-claude-plugins/catalog-snapshot/build'
import { calculateCatalogFingerprint } from '@awesome-claude-plugins/catalog-snapshot/fingerprint'
import Database from 'better-sqlite3'

const SHA256_HEX = /^[a-f0-9]{64}$/

function hashFileSha256(filePath) {
  const hash = createHash('sha256')
  const fd = openSync(filePath, 'r')
  try {
    const chunk = Buffer.allocUnsafe(64 * 1024)
    while (true) {
      const length = readSync(fd, chunk, 0, chunk.length, null)
      if (length === 0) break
      hash.update(chunk.subarray(0, length))
    }
    return hash.digest('hex')
  } finally {
    closeSync(fd)
  }
}

function verifyExistingManifest(outputPath, manifestPath, snapshotId) {
  if (!(existsSync(outputPath) && existsSync(manifestPath))) return
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`Existing catalog manifest is unreadable: ${manifestPath}`, { cause: error })
  }
  if (manifest.snapshotId !== snapshotId) return
  if (!SHA256_HEX.test(manifest.artifactSha256 ?? '')) {
    throw new Error(`Existing catalog manifest lacks a valid SHA-256: ${manifestPath}`)
  }
  if (hashFileSha256(outputPath) !== manifest.artifactSha256) {
    throw new Error(`Existing catalog artifact differs from its published SHA-256: ${outputPath}`)
  }
}

function calculateSnapshotIdentity(repos, stats, schemaVersion, generatorVersion) {
  const reposFingerprint = calculateCatalogFingerprint(repos)
  const hasher = createHash('sha256')
  hasher.update(`schema_version:${schemaVersion};generator_version:${generatorVersion};fingerprint:${reposFingerprint};`)
  if (Array.isArray(stats)) {
    for (const stat of stats) {
      hasher.update(JSON.stringify(stat))
      hasher.update('\n')
    }
  }
  return hasher.digest('hex').slice(0, 16)
}

async function downloadSqliteArtifact(pointer, outputPath) {
  const repo = process.env.GITHUB_REPOSITORY || 'quemsah/awesome-claude-plugins'
  const downloadUrl =
    pointer.artifactUrl ||
    process.env.CATALOG_SQLITE_URL ||
    `https://github.com/${repo}/releases/download/catalog-${pointer.snapshotId}/catalog.sqlite`

  console.log(`[prepare-catalog] Downloading SQLite snapshot artifact from ${downloadUrl}...`)

  mkdirSync(dirname(outputPath), { recursive: true })
  const tmpPath = `${outputPath}.download.${process.pid}.${Date.now()}`

  let downloaded = false
  try {
    const curlArgs = ['-sSL', '--fail', '--retry', '3', '-o', tmpPath]
    if (process.env.GITHUB_TOKEN && downloadUrl.includes('api.github.com')) {
      curlArgs.push('-H', `Authorization: Bearer ${process.env.GITHUB_TOKEN}`)
    }
    curlArgs.push(downloadUrl)
    execFileSync('curl', curlArgs, { stdio: 'inherit' })
    downloaded = true
  } catch {
    downloaded = false
  }

  if (!downloaded) {
    const response = await fetch(downloadUrl, { redirect: 'follow' })
    if (!response.ok) {
      throw new Error(`Failed to download catalog artifact from ${downloadUrl}: ${response.status} ${response.statusText}`)
    }
    const fileStream = createWriteStream(tmpPath)
    await pipeline(Readable.fromWeb(response.body), fileStream)
  }

  const downloadedSha = hashFileSha256(tmpPath)
  if (pointer.artifactSha256 && downloadedSha !== pointer.artifactSha256) {
    try {
      unlinkSync(tmpPath)
    } catch {}
    throw new Error(`Downloaded artifact SHA-256 mismatch: got ${downloadedSha}, expected ${pointer.artifactSha256}`)
  }

  renameSync(tmpPath, outputPath)
  console.log(`[prepare-catalog] Successfully downloaded and verified artifact (SHA: ${downloadedSha})`)
}

function verifySqliteArtifact(outputPath, manifestPath, pointer) {
  const startTime = Date.now()
  console.log(`[prepare-catalog] Validating existing SQLite catalog snapshot at ${outputPath}...`)

  const sha256 = hashFileSha256(outputPath)
  if (pointer?.artifactSha256 && sha256 !== pointer.artifactSha256) {
    throw new Error(`Artifact SHA-256 mismatch with pointer: expected ${pointer.artifactSha256}, got ${sha256}`)
  }

  const db = new Database(outputPath, { readonly: true, fileMustExist: true })
  let metadataRow
  try {
    const check = db.pragma('quick_check')
    if (check[0]?.quick_check !== 'ok') {
      throw new Error(`SQLite quick_check failed: ${JSON.stringify(check)}`)
    }
    metadataRow = db.prepare('SELECT * FROM catalog_metadata WHERE id = 1').get()
    if (!metadataRow) {
      throw new Error('Missing catalog_metadata row in catalog.sqlite')
    }
  } finally {
    db.close()
  }

  if (pointer) {
    if (pointer.snapshotId && metadataRow.snapshot_id !== pointer.snapshotId) {
      throw new Error(`Artifact snapshotId mismatch with pointer: expected ${pointer.snapshotId}, got ${metadataRow.snapshot_id}`)
    }
    if (pointer.catalogFingerprint && metadataRow.catalog_fingerprint !== pointer.catalogFingerprint) {
      throw new Error(
        `Artifact catalogFingerprint mismatch with pointer: expected ${pointer.catalogFingerprint}, got ${metadataRow.catalog_fingerprint}`
      )
    }
  }

  const manifest = {
    schemaVersion: metadataRow.schema_version,
    generatorVersion: metadataRow.generator_version,
    snapshotId: metadataRow.snapshot_id,
    catalogFingerprint: metadataRow.catalog_fingerprint,
    artifactSha256: sha256,
    recordCount: metadataRow.record_count,
    canonicalCount: metadataRow.canonical_count,
    pluginsCount: metadataRow.plugins_count,
    statsCount: metadataRow.stats_count,
    outputPath,
    createdAt: metadataRow.created_at,
  }

  // Check manifest if exists
  if (existsSync(manifestPath)) {
    try {
      const existing = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (existing.artifactSha256 && existing.artifactSha256 !== sha256) {
        throw new Error(`Manifest artifactSha256 mismatch: expected ${existing.artifactSha256}, got ${sha256}`)
      }
    } catch (e) {
      if (e.message.includes('mismatch')) throw e
    }
  }

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
  console.log(`[prepare-catalog] Validated in ${elapsed}s:`)
  console.log(`  Output SQLite:        ${manifest.outputPath}`)
  console.log(`  Artifact SHA-256:     ${manifest.artifactSha256}`)
  console.log(`  Catalog Fingerprint:  ${manifest.catalogFingerprint}`)
  console.log(`  Total Records:        ${manifest.recordCount}`)
  console.log(`  Canonical Records:    ${manifest.canonicalCount}`)
  console.log(`  Total Plugins:        ${manifest.pluginsCount}`)
  console.log(`  Stats History Rows:   ${manifest.statsCount}`)

  return manifest
}

export async function prepareCatalog(options = {}) {
  const dataDir = options.dataDir ?? join(process.cwd(), 'src/data')
  const reposPath = join(dataDir, 'repos.json')
  const statsPath = join(dataDir, 'stats.json')
  const outputPath = options.outputPath ?? join(dataDir, 'catalog.sqlite')
  const manifestPath = options.manifestPath ?? join(dataDir, 'catalog.manifest.json')

  const pointerPath =
    options.pointerPath ??
    [
      join(dataDir, 'catalog-release.json'),
      join(dataDir, '../catalog-release.json'),
      join(dataDir, '../../catalog-release.json'),
      join(process.cwd(), 'catalog-release.json'),
      join(process.cwd(), 'ui/catalog-release.json'),
    ].find((p) => existsSync(p))

  const pointer = pointerPath ? JSON.parse(readFileSync(pointerPath, 'utf8')) : null

  // If SQLite exists and source repos.json does not exist, validate existing SQLite
  if (existsSync(outputPath) && !existsSync(reposPath)) {
    try {
      return verifySqliteArtifact(outputPath, manifestPath, pointer)
    } catch (err) {
      if (pointer?.artifactUrl) {
        console.warn('[prepare-catalog] Existing SQLite artifact is invalid or stale for pointer; re-downloading...')
        try {
          unlinkSync(outputPath)
        } catch {}
        await downloadSqliteArtifact(pointer, outputPath)
        return verifySqliteArtifact(outputPath, manifestPath, pointer)
      }
      throw err
    }
  }

  // If SQLite does not exist and repos.json does not exist, retrieve SQLite using release pointer
  if (!(existsSync(outputPath) || existsSync(reposPath))) {
    if (pointer) {
      await downloadSqliteArtifact(pointer, outputPath)
      return verifySqliteArtifact(outputPath, manifestPath, pointer)
    }
    throw new Error(`Catalog source dataset not found: ${reposPath}`)
  }

  if (!existsSync(reposPath)) {
    throw new Error(`Catalog source dataset not found: ${reposPath}`)
  }
  if (!existsSync(statsPath)) {
    throw new Error(`Catalog statistics dataset not found: ${statsPath}`)
  }

  const startTime = Date.now()
  console.log(`[prepare-catalog] Reading source dataset from ${dataDir}...`)
  const repos = JSON.parse(readFileSync(reposPath, 'utf8'))
  const stats = JSON.parse(readFileSync(statsPath, 'utf8'))

  const identity = calculateSnapshotIdentity(repos, stats, SCHEMA_VERSION, GENERATOR_VERSION)
  const snapshotId = options.snapshotId ?? process.env.CATALOG_SNAPSHOT_ID ?? `snapshot-${identity}`

  verifyExistingManifest(outputPath, manifestPath, snapshotId)

  const provenance =
    options.provenance ??
    (process.env.GITHUB_SHA
      ? {
          commit: process.env.GITHUB_SHA,
          runId: process.env.GITHUB_RUN_ID,
          source: process.env.GITHUB_REPOSITORY ?? 'crawler',
        }
      : undefined)

  console.log(`[prepare-catalog] Building SQLite snapshot for ${repos.length} records and ${stats.length} stats entries...`)

  const manifest = buildPublicCatalog(
    {
      records: repos,
      stats,
      snapshotId,
      createdAt: new Date().toISOString(),
      provenance,
    },
    outputPath
  )

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
  console.log(`[prepare-catalog] Completed in ${elapsed}s:`)
  console.log(`  Output SQLite:        ${manifest.outputPath}`)
  console.log(`  Artifact SHA-256:     ${manifest.artifactSha256}`)
  console.log(`  Catalog Fingerprint:  ${manifest.catalogFingerprint}`)
  console.log(`  Total Records:        ${manifest.recordCount}`)
  console.log(`  Canonical Records:    ${manifest.canonicalCount}`)
  console.log(`  Total Plugins:        ${manifest.pluginsCount}`)
  console.log(`  Stats History Rows:   ${manifest.statsCount}`)

  return manifest
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  prepareCatalog().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
