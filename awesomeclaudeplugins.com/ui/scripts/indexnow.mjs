import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCatalogRecordsFromSqlite, diffCatalogRecords } from './indexnow-changes.mjs'
import { loadBaseline, saveBaseline, sendIndexNowBatch } from './indexnow-state.mjs'

const SITE_URL = process.env.INDEXNOW_SITE_URL ?? 'https://awesomeclaudeplugins.com'
const SITEMAP_URL = new URL('/sitemap.xml', SITE_URL)
const INDEXNOW_KEY = '14273a4aad028282eac8537cb6ea0e5f'
const KEY_LOCATION = new URL(`/${INDEXNOW_KEY}.txt`, SITE_URL).toString()
const MAX_URLS_PER_REQUEST = Number(process.env.INDEXNOW_BATCH_SIZE) || 10_000
const MODE = process.env.INDEXNOW_MODE ?? 'full'
const RESOLVE_DEPLOYED = process.env.INDEXNOW_RESOLVE_DEPLOYED === 'true'
const SNAPSHOT_ID_PATTERN = /^[a-zA-Z0-9._-]+$/
const REPOSITORY_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/
const RELEASE_SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/i
const MAX_CATALOG_ARTIFACT_BYTES = 512 * 1024 * 1024
const CATALOG_FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/i
const BASELINE_PATH =
  process.env.INDEXNOW_BASELINE_PATH ?? fileURLToPath(new URL('../.indexnow-cache/indexnow-state.sqlite', import.meta.url))
const CATALOG_PATH = process.env.CATALOG_SQLITE_PATH ?? fileURLToPath(new URL('../src/data/catalog.sqlite', import.meta.url))
const MAX_READY_ATTEMPTS = 12
const READY_RETRY_DELAY_MS = 15_000
const READY_CONCURRENCY = 20
const DEFER_UNTIL_DEPLOYED = process.env.INDEXNOW_DEFER_UNTIL_DEPLOYED === 'true'

if (MODE !== 'full' && MODE !== 'changed') {
  throw new Error(`Unsupported IndexNow mode: ${MODE}`)
}

const keyFile = readFileSync(new URL(`../public/${INDEXNOW_KEY}.txt`, import.meta.url), 'utf8').trim()
if (keyFile !== INDEXNOW_KEY) {
  throw new Error(`IndexNow key file does not contain the expected key: ${INDEXNOW_KEY}.txt`)
}

async function fetchXml(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
  }
  return response.text()
}

async function sitemapUrls(url) {
  const xml = await fetchXml(url)
  const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
  if (locations.length === 0) {
    throw new Error(`No URLs found in ${url}`)
  }
  if (xml.includes('<sitemapindex')) {
    const nested = await Promise.all(locations.map((location) => sitemapUrls(new URL(location))))
    return nested.flat()
  }
  return locations
}

function readCurrentCatalog() {
  if (!existsSync(CATALOG_PATH)) {
    throw new Error(`Catalog snapshot SQLite database not found at ${CATALOG_PATH}`)
  }
  return buildCatalogRecordsFromSqlite(CATALOG_PATH, SITE_URL)
}

function getLegacyBaselinePath() {
  const dir = dirname(BASELINE_PATH)
  const candidateFromBaselineDir = join(dir, 'repos.json')
  if (existsSync(candidateFromBaselineDir)) return candidateFromBaselineDir
  const legacyLocal = fileURLToPath(new URL('../.indexnow-cache/repos.json', import.meta.url))
  if (existsSync(legacyLocal)) return legacyLocal
  return null
}

function hasBaseline() {
  if (existsSync(BASELINE_PATH)) return true
  return getLegacyBaselinePath() !== null
}

function verifyMigratedBaseline(sourceRecords, targetPath) {
  const migrated = loadBaseline(targetPath)
  if (migrated.size !== sourceRecords.size) {
    throw new Error(`IndexNow baseline migration verification failed: expected ${sourceRecords.size} records, got ${migrated.size}`)
  }
  for (const [key, sourceRecord] of sourceRecords.entries()) {
    const targetRecord = migrated.get(key)
    if (!targetRecord || targetRecord.url !== sourceRecord.url || targetRecord.fingerprint !== sourceRecord.fingerprint) {
      throw new Error(`IndexNow baseline migration verification failed for record key ${key}`)
    }
  }
}

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) {
    const legacyPath = getLegacyBaselinePath()
    if (legacyPath) {
      console.log(`Migrating legacy IndexNow baseline from ${legacyPath}...`)
      const legacyRecords = loadBaseline(legacyPath)
      writeBaseline(legacyRecords)
      verifyMigratedBaseline(legacyRecords, BASELINE_PATH)
      console.log(`Successfully verified migration of ${legacyRecords.size} records to SQLite baseline.`)
      return legacyRecords
    }
    throw new Error('No successful IndexNow baseline exists. Run workflow_dispatch with mode=full on the default branch first.')
  }
  return loadBaseline(BASELINE_PATH)
}

function writeBaseline(records, includedUrls = null) {
  mkdirSync(dirname(BASELINE_PATH), { recursive: true })
  saveBaseline(BASELINE_PATH, records, includedUrls)
  const count = [...records.values()].filter((record) => includedUrls === null || includedUrls.has(record.url)).length
  console.log(`Saved baseline for ${count.toLocaleString()} indexable repositories.`)
}

async function waitForCatalogDeployment(fingerprint) {
  const url = new URL('/api/catalog-version', SITE_URL)
  let lastReason = 'not checked'
  const attempts = DEFER_UNTIL_DEPLOYED ? 1 : MAX_READY_ATTEMPTS
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(10_000),
      })
      if (response.ok) {
        const deployed = await response.json()
        if (deployed?.sha256 === fingerprint) {
          console.log('Live catalog fingerprint matches the checked-out snapshot.')
          return true
        }
        lastReason = 'deployed snapshot differs from checkout'
      } else {
        lastReason = `HTTP ${response.status}`
      }
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error)
    }
    if (attempt < attempts) {
      console.log(`Waiting for the catalog deployment (${attempt}/${MAX_READY_ATTEMPTS}): ${lastReason}`)
      await new Promise((resolve) => setTimeout(resolve, READY_RETRY_DELAY_MS))
    }
  }
  if (DEFER_UNTIL_DEPLOYED) {
    console.log(`IndexNow deferred until the next scheduled run: ${lastReason}. Baseline was not advanced.`)
    return false
  }
  throw new Error(`Catalog deployment was not ready: ${lastReason}. IndexNow baseline was not advanced.`)
}

async function resolveReleaseArtifact(snapshotId) {
  const repository = process.env.GITHUB_REPOSITORY ?? 'quemsah/awesome-claude-plugins'
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new Error('Cannot resolve deployed catalog: invalid GitHub repository')
  }

  const releaseTag = `catalog-${snapshotId}`
  const assetUrl = `https://github.com/${repository}/releases/download/${releaseTag}/catalog.sqlite`
  const releaseApiUrl = `https://api.github.com/repos/${repository}/releases/tags/${releaseTag}`
  const headers = new Headers({ accept: 'application/vnd.github+json' })
  if (process.env.GITHUB_TOKEN) headers.set('authorization', `Bearer ${process.env.GITHUB_TOKEN}`)
  const response = await fetch(releaseApiUrl, {
    headers,
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`Failed to read catalog release ${releaseTag}: HTTP ${response.status}`)

  const release = await response.json()
  if (release?.tag_name !== releaseTag) {
    throw new Error(`Catalog release tag mismatch: expected ${releaseTag}`)
  }
  const assets = Array.isArray(release.assets) ? release.assets.filter((asset) => asset?.name === 'catalog.sqlite') : []
  if (assets.length !== 1 || assets[0].state !== 'uploaded' || assets[0].browser_download_url !== assetUrl) {
    throw new Error(`Expected exactly one uploaded catalog.sqlite for release ${releaseTag}`)
  }
  const asset = assets[0]
  if (typeof asset.digest !== 'string' || !RELEASE_SHA256_PATTERN.test(asset.digest)) {
    throw new Error(`Catalog release ${releaseTag} lacks a verifiable SHA-256 asset digest`)
  }
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0) {
    throw new Error(`Catalog release ${releaseTag} has an invalid artifact size`)
  }
  if (asset.size > MAX_CATALOG_ARTIFACT_BYTES) {
    throw new Error(`Catalog release ${releaseTag} exceeds the maximum permitted artifact size`)
  }
  return { artifactUrl: assetUrl, expectedSha256: asset.digest.slice('sha256:'.length).toLowerCase(), expectedSize: asset.size }
}

/** Download a release asset with bounded memory, streaming hash verification and clean cancellation. */
async function downloadVerifiedArtifact({ artifactUrl, tempPath, expectedSize, expectedSha256, snapshotId }) {
  const response = await fetch(artifactUrl, { signal: AbortSignal.timeout(300_000) })
  if (!response.ok) throw new Error(`Failed to download deployed catalog ${snapshotId}: HTTP ${response.status}`)
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Deployed catalog download has no readable body')

  const digest = createHash('sha256')
  let fd
  let downloaded = 0
  let completed = false
  try {
    fd = openSync(tempPath, 'wx')
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      downloaded += value.byteLength
      if (downloaded > expectedSize || downloaded > MAX_CATALOG_ARTIFACT_BYTES) {
        throw new Error('Downloaded catalog artifact exceeds its declared or maximum permitted size')
      }
      digest.update(value)
      let offset = 0
      while (offset < value.byteLength) {
        const written = writeSync(fd, value, offset, value.byteLength - offset)
        if (written <= 0) throw new Error('Unable to write downloaded catalog artifact')
        offset += written
      }
    }
    completed = true
  } finally {
    try {
      if (fd !== undefined) closeSync(fd)
    } finally {
      // releaseLock() alone does not stop an unfinished HTTP response body.
      if (!completed) await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }

  if (downloaded !== expectedSize) {
    throw new Error(`Downloaded catalog artifact size mismatch: expected ${expectedSize}, got ${downloaded}`)
  }
  if (digest.digest('hex') !== expectedSha256) {
    throw new Error('Downloaded catalog artifact SHA-256 mismatch')
  }
}

async function resolveDeployedCatalog(localCatalog) {
  if (!RESOLVE_DEPLOYED) return localCatalog

  try {
    const versionResponse = await fetch(new URL('/api/catalog-version', SITE_URL), {
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!versionResponse.ok) throw new Error(`Catalog version returned HTTP ${versionResponse.status}`)
    const deployed = await versionResponse.json()
    if (deployed?.sha256 === localCatalog.fingerprint) return localCatalog
    if (typeof deployed?.snapshotId !== 'string' || !SNAPSHOT_ID_PATTERN.test(deployed.snapshotId)) {
      throw new Error('Cannot resolve deployed catalog: production returned an invalid snapshotId')
    }
    if (typeof deployed?.sha256 !== 'string' || !CATALOG_FINGERPRINT_PATTERN.test(deployed.sha256)) {
      throw new Error('Cannot resolve deployed catalog: production returned an invalid fingerprint')
    }

    // Release asset digests come from GitHub, independently of SQLite metadata.
    // Do not trust only the digest stored inside a downloaded SQLite file.
    const { artifactUrl, expectedSha256, expectedSize } = await resolveReleaseArtifact(deployed.snapshotId)
    const tempDir = mkdtempSync(join(tmpdir(), 'indexnow-catalog-'))
    const tempPath = join(tempDir, 'catalog.sqlite')
    try {
      await downloadVerifiedArtifact({ artifactUrl, tempPath, expectedSize, expectedSha256, snapshotId: deployed.snapshotId })
      const resolved = buildCatalogRecordsFromSqlite(tempPath, SITE_URL, {
        snapshotId: deployed.snapshotId,
        catalogFingerprint: deployed.sha256,
      })
      console.log(`Resolved deployed catalog snapshot ${deployed.snapshotId} (SHA-256 verified).`)
      return resolved
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  } catch (error) {
    if (!DEFER_UNTIL_DEPLOYED) throw error
    console.log(
      `IndexNow deferred until the next scheduled run: ${error instanceof Error ? error.message : String(error)}. Baseline was not advanced.`
    )
    return null
  }
}

async function waitForChangedPages(urls) {
  let pending = urls.map((url) => ({ url, reason: 'not checked' }))
  for (let attempt = 1; attempt <= MAX_READY_ATTEMPTS && pending.length > 0; attempt += 1) {
    console.log(`Checking ${pending.length} changed URL(s), readiness pass ${attempt}/${MAX_READY_ATTEMPTS}.`)
    const failures = []
    let cursor = 0
    await Promise.all(
      Array.from({ length: Math.min(READY_CONCURRENCY, pending.length) }, async () => {
        while (cursor < pending.length) {
          const item = pending[cursor]
          cursor += 1
          try {
            const response = await fetch(item.url, {
              method: 'HEAD',
              redirect: 'manual',
              signal: AbortSignal.timeout(15_000),
            })
            if (response.status !== 200) failures.push({ url: item.url, reason: `HTTP ${response.status}` })
          } catch (error) {
            failures.push({ url: item.url, reason: error instanceof Error ? error.message : String(error) })
          }
        }
      })
    )
    pending = failures
    if (pending.length > 0 && attempt < MAX_READY_ATTEMPTS) {
      console.log(
        `Deployment readiness check ${attempt}/${MAX_READY_ATTEMPTS}: ${pending.length} URL(s) are not ready; retrying in ${READY_RETRY_DELAY_MS / 1000}s.`
      )
      await new Promise((resolve) => setTimeout(resolve, READY_RETRY_DELAY_MS))
    }
  }

  if (pending.length > 0) {
    const examples = pending
      .slice(0, 10)
      .map(({ url, reason }) => `${url} (${reason})`)
      .join('\n')
    throw new Error(
      `${pending.length} changed repository URL(s) did not return HTTP 200 after ${MAX_READY_ATTEMPTS} checks. IndexNow was not called.\n${examples}`
    )
  }
}

async function submitUrls(urls, expectedFingerprint) {
  for (let offset = 0; offset < urls.length; offset += MAX_URLS_PER_REQUEST) {
    if (expectedFingerprint && offset > 0) {
      const stillDeployed = await waitForCatalogDeployment(expectedFingerprint)
      if (!stillDeployed) {
        throw new Error('Catalog deployment changed between batch submissions. Aborting IndexNow without advancing baseline.')
      }
    }
    const urlList = urls.slice(offset, offset + MAX_URLS_PER_REQUEST)
    await sendIndexNowBatch(urlList, { siteUrl: SITE_URL, key: INDEXNOW_KEY, keyLocation: KEY_LOCATION })
    console.log(`Submitted ${urlList.length} URL${urlList.length === 1 ? '' : 's'} to IndexNow.`)
  }
}

async function runIndexNow() {
  const currentCatalog = await resolveDeployedCatalog(readCurrentCatalog())
  if (!currentCatalog) return
  const { records: currentRecords, fingerprint: currentFingerprint } = currentCatalog
  // An HTTP 200 on a pre-existing page does not prove that new catalog data is live.
  // Never advance the baseline until the deployed build exposes the exact catalog snapshot.
  const isDeployed = await waitForCatalogDeployment(currentFingerprint)
  if (!isDeployed) return

  // On a fresh install the scheduled job establishes the baseline automatically.
  if (MODE === 'full' || !hasBaseline()) {
    if (MODE === 'changed') console.log('IndexNow baseline missing; submitting the live sitemap to initialize it.')
    const urls = await sitemapUrls(SITEMAP_URL)
    await submitUrls(urls, currentFingerprint)
    const stillDeployed = await waitForCatalogDeployment(currentFingerprint)
    if (!stillDeployed) {
      console.log('Catalog deployment changed before baseline update. Aborting IndexNow without advancing baseline.')
      return
    }
    writeBaseline(currentRecords, new Set(urls))
  } else {
    const previousRecords = readBaseline()
    const { changedUrls, retiredUrls } = diffCatalogRecords(previousRecords, currentRecords)
    console.log(`IndexNow delta: ${changedUrls.length} added/updated, ${retiredUrls.length} retired URLs.`)
    if (changedUrls.length > 0) await waitForChangedPages(changedUrls)
    const urls = [...new Set([...changedUrls, ...retiredUrls])]
    if (urls.length > 0) {
      if (changedUrls.length > 0) {
        const stillDeployed = await waitForCatalogDeployment(currentFingerprint)
        if (!stillDeployed) {
          console.log('Catalog deployment changed before submission. Aborting IndexNow without advancing baseline.')
          return
        }
      }
      await submitUrls(urls, currentFingerprint)
      const stillDeployedFinal = await waitForCatalogDeployment(currentFingerprint)
      if (!stillDeployedFinal) {
        console.log('Catalog deployment changed before baseline update. Aborting IndexNow without advancing baseline.')
        return
      }
      writeBaseline(currentRecords)
    } else {
      console.log('No changed or retired indexable repository URLs.')
    }
  }
}

await runIndexNow()
