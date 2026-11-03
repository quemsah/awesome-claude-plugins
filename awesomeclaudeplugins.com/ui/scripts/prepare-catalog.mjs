import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
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

function validatePointerStrings(pointer) {
  if (typeof pointer.snapshotId !== 'string' || !pointer.snapshotId.trim()) {
    throw new Error('Invalid catalog release pointer: missing or invalid snapshotId')
  }
  if (typeof pointer.catalogFingerprint !== 'string' || !pointer.catalogFingerprint.trim()) {
    throw new Error('Invalid catalog release pointer: missing or invalid catalogFingerprint')
  }
  if (typeof pointer.artifactSha256 !== 'string' || !SHA256_HEX.test(pointer.artifactSha256)) {
    throw new Error(`Invalid catalog release pointer: invalid artifactSha256 (expected 64-char hex, got "${pointer.artifactSha256}")`)
  }
  if (!Number.isInteger(pointer.schemaVersion) || pointer.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Invalid catalog release pointer: unsupported schemaVersion ${pointer.schemaVersion} (expected ${SCHEMA_VERSION})`)
  }
}

function validatePointerCounts(pointer) {
  const counts = ['recordCount', 'canonicalCount', 'pluginsCount', 'statsCount']
  for (const field of counts) {
    if (!Number.isInteger(pointer[field]) || pointer[field] < 0) {
      throw new Error(`Invalid catalog release pointer: missing or invalid ${field}`)
    }
  }
}

export function validateReleasePointer(pointer) {
  if (!pointer || typeof pointer !== 'object' || Array.isArray(pointer)) {
    throw new Error('Invalid catalog release pointer: expected a JSON object')
  }
  validatePointerStrings(pointer)
  validatePointerCounts(pointer)
  return pointer
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

const MAX_ARTIFACT_BYTE_SIZE = 500 * 1024 * 1024 // 500 MB
const DOWNLOAD_TIMEOUT_MS = 300_000 // 300 seconds

const DEFAULT_ALLOWED_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'raw.githubusercontent.com',
])

export function validateDownloadUrl(urlStr) {
  let parsed
  try {
    parsed = new URL(urlStr)
  } catch (err) {
    throw new Error(`Invalid download URL: "${urlStr}"`, { cause: err })
  }

  const isTest = Boolean(process.env.VITEST || process.env.NODE_ENV === 'test')
  if (parsed.protocol === 'file:') {
    if (!isTest) {
      throw new Error(`Insecure download protocol "${parsed.protocol}": file URLs are only allowed in test environments`)
    }
    return parsed
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`Insecure download protocol "${parsed.protocol}": expected HTTPS`)
  }

  const customAllowed = process.env.CATALOG_ALLOWED_HOSTS
    ? process.env.CATALOG_ALLOWED_HOSTS.split(',').map((h) => h.trim().toLowerCase())
    : []
  const allowed = new Set([...DEFAULT_ALLOWED_HOSTS, ...customAllowed])
  if (isTest) {
    allowed.add('localhost')
    allowed.add('127.0.0.1')
  }

  const hostname = parsed.hostname.toLowerCase()
  const isAllowed = allowed.has(hostname) || hostname.endsWith('.githubusercontent.com') || hostname.endsWith('.github.com')

  if (!isAllowed) {
    throw new Error(`Disallowed catalog download host: "${parsed.hostname}". Allowed hosts: ${[...allowed].join(', ')}`)
  }

  return parsed
}

async function fetchWithSafeRedirects(initialUrl, maxRedirects = 5) {
  let currentUrl = initialUrl
  let redirects = 0

  while (true) {
    const currentParsed = validateDownloadUrl(currentUrl)
    if (currentParsed.protocol === 'file:') {
      const filePath = fileURLToPath(currentUrl)
      return {
        body: Readable.toWeb(createReadStream(filePath)),
        status: 200,
        ok: true,
        headers: new Headers({ 'content-length': String(statSync(filePath).size) }),
      }
    }

    const headers = {}
    if (process.env.GITHUB_TOKEN && currentParsed.hostname === 'api.github.com') {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
    }

    const timeoutSignal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
    const response = await fetch(currentUrl, {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: timeoutSignal,
    })

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) {
        throw new Error(`Redirect from ${currentUrl} returned status ${response.status} without Location header`)
      }
      redirects++
      if (redirects > maxRedirects) {
        throw new Error(`Too many redirects downloading artifact from ${initialUrl} (max ${maxRedirects})`)
      }
      const nextUrl = new URL(location, currentUrl).toString()
      validateDownloadUrl(nextUrl)
      currentUrl = nextUrl
      continue
    }

    if (!response.ok) {
      throw new Error(`Failed to download catalog artifact from ${currentUrl}: ${response.status} ${response.statusText}`)
    }

    return response
  }
}

async function downloadSqliteArtifact(pointer, outputPath) {
  const repo = process.env.GITHUB_REPOSITORY || 'quemsah/awesome-claude-plugins'
  const downloadUrl =
    pointer.artifactUrl ||
    process.env.CATALOG_SQLITE_URL ||
    `https://github.com/${repo}/releases/download/catalog-${pointer.snapshotId}/catalog.sqlite`

  validateDownloadUrl(downloadUrl)
  console.log(`[prepare-catalog] Downloading SQLite snapshot artifact from ${downloadUrl}...`)

  mkdirSync(dirname(outputPath), { recursive: true })
  const tmpPath = `${outputPath}.download.${process.pid}.${Date.now()}`

  try {
    const response = await fetchWithSafeRedirects(downloadUrl)
    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_ARTIFACT_BYTE_SIZE) {
      throw new Error(`Artifact size ${contentLength} bytes exceeds limit of ${MAX_ARTIFACT_BYTE_SIZE} bytes`)
    }
    let streamedBytes = 0
    const sizeLimitTransform = new Transform({
      transform(chunk, _encoding, callback) {
        streamedBytes += chunk.length
        if (streamedBytes > MAX_ARTIFACT_BYTE_SIZE) {
          callback(new Error(`Downloaded artifact exceeds maximum allowed size of ${MAX_ARTIFACT_BYTE_SIZE} bytes during streaming`))
        } else {
          callback(null, chunk)
        }
      },
    })
    const fileStream = createWriteStream(tmpPath)
    await pipeline(Readable.fromWeb(response.body), sizeLimitTransform, fileStream)

    const stat = statSync(tmpPath)
    if (stat.size > MAX_ARTIFACT_BYTE_SIZE) {
      throw new Error(`Downloaded artifact exceeds maximum allowed size of ${MAX_ARTIFACT_BYTE_SIZE} bytes`)
    }

    const downloadedSha = hashFileSha256(tmpPath)
    if (downloadedSha !== pointer.artifactSha256) {
      throw new Error(`Downloaded artifact SHA-256 mismatch: got ${downloadedSha}, expected ${pointer.artifactSha256}`)
    }

    renameSync(tmpPath, outputPath)
    console.log(`[prepare-catalog] Successfully downloaded and verified artifact (SHA: ${downloadedSha})`)
  } finally {
    if (existsSync(tmpPath)) {
      try {
        unlinkSync(tmpPath)
      } catch {}
    }
  }
}

function readMetadataFromSqlite(outputPath) {
  const db = new Database(outputPath, { readonly: true, fileMustExist: true })
  try {
    const check = db.pragma('quick_check')
    if (check[0]?.quick_check !== 'ok') {
      throw new Error(`SQLite quick_check failed: ${JSON.stringify(check)}`)
    }
    const metadataRow = db.prepare('SELECT * FROM catalog_metadata WHERE id = 1').get()
    if (!metadataRow) {
      throw new Error('Missing catalog_metadata row in catalog.sqlite')
    }
    return metadataRow
  } finally {
    db.close()
  }
}

function verifyPointerMatchesMetadata(pointer, metadataRow) {
  if (!pointer) return
  if (metadataRow.snapshot_id !== pointer.snapshotId) {
    throw new Error(`Artifact snapshotId mismatch with pointer: expected ${pointer.snapshotId}, got ${metadataRow.snapshot_id}`)
  }
  if (metadataRow.catalog_fingerprint !== pointer.catalogFingerprint) {
    throw new Error(
      `Artifact catalogFingerprint mismatch with pointer: expected ${pointer.catalogFingerprint}, got ${metadataRow.catalog_fingerprint}`
    )
  }
  if (metadataRow.record_count !== pointer.recordCount) {
    throw new Error(`Artifact recordCount mismatch with pointer: expected ${pointer.recordCount}, got ${metadataRow.record_count}`)
  }
  if (metadataRow.canonical_count !== pointer.canonicalCount) {
    throw new Error(`Artifact canonicalCount mismatch with pointer: expected ${pointer.canonicalCount}, got ${metadataRow.canonical_count}`)
  }
  if (metadataRow.plugins_count !== pointer.pluginsCount) {
    throw new Error(`Artifact pluginsCount mismatch with pointer: expected ${pointer.pluginsCount}, got ${metadataRow.plugins_count}`)
  }
  if (metadataRow.stats_count !== pointer.statsCount) {
    throw new Error(`Artifact statsCount mismatch with pointer: expected ${pointer.statsCount}, got ${metadataRow.stats_count}`)
  }
}

export function verifySqliteArtifact(outputPath, manifestPath, pointer, { writeManifest = true } = {}) {
  const startTime = Date.now()
  console.log(`[prepare-catalog] Validating existing SQLite catalog snapshot at ${outputPath}...`)

  const sha256 = hashFileSha256(outputPath)
  if (pointer && sha256 !== pointer.artifactSha256) {
    throw new Error(`Artifact SHA-256 mismatch with pointer: expected ${pointer.artifactSha256}, got ${sha256}`)
  }

  const metadataRow = readMetadataFromSqlite(outputPath)
  verifyPointerMatchesMetadata(pointer, metadataRow)

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

  if (!pointer && existsSync(manifestPath)) {
    try {
      const existing = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (existing.artifactSha256 && existing.artifactSha256 !== sha256) {
        throw new Error(`Manifest artifactSha256 mismatch: expected ${existing.artifactSha256}, got ${sha256}`)
      }
    } catch (e) {
      if (e.message.includes('mismatch')) throw e
    }
  }

  if (writeManifest) {
    const tmpManifest = `${manifestPath}.${randomUUID()}.tmp`
    writeFileSync(tmpManifest, `${JSON.stringify(manifest, null, 2)}\n`)
    renameSync(tmpManifest, manifestPath)
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
  console.log(`[prepare-catalog] Validated in ${elapsed}s: ${manifest.recordCount} total, ${manifest.canonicalCount} canonical records`)
  return manifest
}

async function downloadAndVerifyAtomic(pointer, outputPath, manifestPath) {
  mkdirSync(dirname(outputPath), { recursive: true })
  const tmpPath = `${outputPath}.${randomUUID()}.tmp`
  try {
    await downloadSqliteArtifact(pointer, tmpPath)
    const verifiedManifest = verifySqliteArtifact(tmpPath, manifestPath, pointer, { writeManifest: false })
    renameSync(tmpPath, outputPath)
    verifiedManifest.outputPath = outputPath
    const tmpManifest = `${manifestPath}.${randomUUID()}.tmp`
    writeFileSync(tmpManifest, `${JSON.stringify(verifiedManifest, null, 2)}\n`)
    renameSync(tmpManifest, manifestPath)
    return verifiedManifest
  } finally {
    if (existsSync(tmpPath)) {
      try {
        unlinkSync(tmpPath)
      } catch {}
    }
  }
}

function resolveCatalogPaths(options) {
  const dataDir = options.dataDir ?? join(process.cwd(), 'src/data')
  const fixturePath = process.env.STANDALONE_E2E === '1' ? process.env.CATALOG_DATA_PATH : undefined
  if (process.env.STANDALONE_E2E === '1' && !fixturePath) {
    throw new Error('STANDALONE_E2E requires CATALOG_DATA_PATH')
  }
  const reposPath = fixturePath ?? join(dataDir, 'repos.json')
  const statsPath = join(dataDir, 'stats.json')
  const outputPath = options.outputPath ?? (fixturePath ? process.env.CATALOG_SQLITE_PATH : undefined) ?? join(dataDir, 'catalog.sqlite')
  const manifestPath =
    options.manifestPath ??
    (fixturePath ? process.env.CATALOG_MANIFEST_PATH : undefined) ??
    join(dirname(outputPath), 'catalog.manifest.json')

  const pointerPath = fixturePath
    ? undefined
    : (options.pointerPath ??
      [
        join(dataDir, 'catalog-release.json'),
        join(dataDir, '../catalog-release.json'),
        join(dataDir, '../../catalog-release.json'),
        join(process.cwd(), 'catalog-release.json'),
        join(process.cwd(), 'ui/catalog-release.json'),
      ].find((p) => existsSync(p)))

  return { dataDir, fixturePath, reposPath, statsPath, outputPath, manifestPath, pointerPath }
}

function resolveReleasePointer(options, pointerPath) {
  if (options.pointer) return validateReleasePointer(options.pointer)
  if (process.env.CATALOG_RELEASE_POINTER) {
    try {
      const raw = process.env.CATALOG_RELEASE_POINTER.trim().startsWith('{')
        ? JSON.parse(process.env.CATALOG_RELEASE_POINTER)
        : JSON.parse(readFileSync(process.env.CATALOG_RELEASE_POINTER, 'utf8'))
      return validateReleasePointer(raw)
    } catch (err) {
      throw new Error(`Invalid CATALOG_RELEASE_POINTER environment variable: ${err.message}`, { cause: err })
    }
  }
  if (pointerPath) {
    const rawPointer = JSON.parse(readFileSync(pointerPath, 'utf8'))
    return validateReleasePointer(rawPointer)
  }
  return null
}

function buildSnapshotFromSource(paths, options) {
  const { reposPath, statsPath, fixturePath, dataDir, outputPath, manifestPath } = paths
  if (!existsSync(reposPath)) throw new Error(`Catalog source dataset not found: ${reposPath}`)
  if (!(fixturePath || existsSync(statsPath))) throw new Error(`Catalog statistics dataset not found: ${statsPath}`)

  const startTime = Date.now()
  console.log(`[prepare-catalog] Reading source dataset from ${dataDir}...`)
  const repos = JSON.parse(readFileSync(reposPath, 'utf8'))
  const stats = fixturePath
    ? [{ id: 1, date: '2026-11-01T00:00:00.000Z', size: repos.length }]
    : JSON.parse(readFileSync(statsPath, 'utf8'))

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
  console.log(`[prepare-catalog] Completed in ${elapsed}s: ${manifest.recordCount} total records`)
  return manifest
}

export async function prepareCatalog(options = {}) {
  const paths = resolveCatalogPaths(options)
  const pointer = resolveReleasePointer(options, paths.pointerPath)

  if (existsSync(paths.outputPath) && !existsSync(paths.reposPath)) {
    try {
      return verifySqliteArtifact(paths.outputPath, paths.manifestPath, pointer)
    } catch (err) {
      if (pointer) {
        console.warn('[prepare-catalog] Existing SQLite artifact is invalid or stale for pointer; re-downloading...')
        return await downloadAndVerifyAtomic(pointer, paths.outputPath, paths.manifestPath)
      }
      throw err
    }
  }

  if (!(existsSync(paths.outputPath) || existsSync(paths.reposPath))) {
    if (pointer) {
      return await downloadAndVerifyAtomic(pointer, paths.outputPath, paths.manifestPath)
    }
    throw new Error(`Catalog source dataset not found: ${paths.reposPath}`)
  }

  return buildSnapshotFromSource(paths, options)
}

function parseCliArgs(argv) {
  const options = {}
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--source' && argv[i + 1]) {
      options.dataDir = resolve(argv[++i])
    } else if (arg.startsWith('--source=')) {
      options.dataDir = resolve(arg.slice('--source='.length))
    } else if (arg === '--output' && argv[i + 1]) {
      options.outputPath = resolve(argv[++i])
    } else if (arg.startsWith('--output=')) {
      options.outputPath = resolve(arg.slice('--output='.length))
    } else if (arg === '--pointer' && argv[i + 1]) {
      options.pointerPath = resolve(argv[++i])
    } else if (arg.startsWith('--pointer=')) {
      options.pointerPath = resolve(arg.slice('--pointer='.length))
    }
  }
  return options
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseCliArgs(process.argv)
  prepareCatalog(options).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
