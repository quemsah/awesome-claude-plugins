import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCatalogRecords, diffCatalogRecords, fingerprintCatalog } from './indexnow-changes.mjs'
import { deserializeBaseline, sendIndexNowBatch, serializeBaseline } from './indexnow-state.mjs'

const SITE_URL = process.env.INDEXNOW_SITE_URL ?? 'https://awesomeclaudeplugins.com'
const SITEMAP_URL = new URL('/sitemap.xml', SITE_URL)
const INDEXNOW_KEY = '14273a4aad028282eac8537cb6ea0e5f'
const KEY_LOCATION = new URL(`/${INDEXNOW_KEY}.txt`, SITE_URL).toString()
const MAX_URLS_PER_REQUEST = 10_000
const MODE = process.env.INDEXNOW_MODE ?? 'full'
const BASELINE_PATH = process.env.INDEXNOW_BASELINE_PATH ?? fileURLToPath(new URL('../.indexnow-cache/repos.json', import.meta.url))
const MAX_READY_ATTEMPTS = 12
const READY_RETRY_DELAY_MS = 15_000
const READY_CONCURRENCY = 20

if (MODE !== 'full' && MODE !== 'changed') {
  throw new Error(`Unsupported IndexNow mode: ${MODE}`)
}

const keyFile = readFileSync(new URL(`../public/${INDEXNOW_KEY}.txt`, import.meta.url), 'utf8').trim()
if (keyFile !== INDEXNOW_KEY) {
  throw new Error(`IndexNow key file does not contain the expected key: ${INDEXNOW_KEY}.txt`)
}

async function fetchXml(url) {
  const response = await fetch(url)
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
  const repos = JSON.parse(readFileSync(new URL('../src/data/repos.json', import.meta.url), 'utf8'))
  if (!Array.isArray(repos)) throw new Error('Catalog snapshot must be an array.')
  return { records: buildCatalogRecords(repos, SITE_URL), fingerprint: fingerprintCatalog(repos) }
}

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) {
    throw new Error('No successful IndexNow baseline exists. Run workflow_dispatch with mode=full on the default branch first.')
  }
  return deserializeBaseline(readFileSync(BASELINE_PATH, 'utf8'))
}

function writeBaseline(records, includedUrls = null) {
  mkdirSync(dirname(BASELINE_PATH), { recursive: true })
  writeFileSync(BASELINE_PATH, serializeBaseline(records, includedUrls))
  const count = [...records.values()].filter((record) => includedUrls === null || includedUrls.has(record.url)).length
  console.log(`Saved baseline for ${count.toLocaleString()} indexable repositories.`)
}

async function waitForCatalogDeployment(fingerprint) {
  const url = new URL('/api/catalog-version', SITE_URL)
  let lastReason = 'not checked'
  for (let attempt = 1; attempt <= MAX_READY_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(10_000),
      })
      if (response.ok) {
        const deployed = await response.json()
        if (deployed?.sha256 === fingerprint) {
          console.log('Live catalog fingerprint matches the checked-out snapshot.')
          return
        }
        lastReason = 'deployed snapshot differs from checkout'
      } else {
        lastReason = `HTTP ${response.status}`
      }
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error)
    }
    if (attempt < MAX_READY_ATTEMPTS) {
      console.log(`Waiting for the catalog deployment (${attempt}/${MAX_READY_ATTEMPTS}): ${lastReason}`)
      await new Promise((resolve) => setTimeout(resolve, READY_RETRY_DELAY_MS))
    }
  }
  throw new Error(`Catalog deployment was not ready: ${lastReason}. IndexNow baseline was not advanced.`)
}

async function waitForChangedPages(urls) {
  let pending = urls.map((url) => ({ url, reason: 'not checked' }))
  for (let attempt = 1; attempt <= MAX_READY_ATTEMPTS && pending.length > 0; attempt += 1) {
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

async function submitUrls(urls) {
  for (let offset = 0; offset < urls.length; offset += MAX_URLS_PER_REQUEST) {
    const urlList = urls.slice(offset, offset + MAX_URLS_PER_REQUEST)
    await sendIndexNowBatch(urlList, { siteUrl: SITE_URL, key: INDEXNOW_KEY, keyLocation: KEY_LOCATION })
    console.log(`Submitted ${urlList.length} URL${urlList.length === 1 ? '' : 's'} to IndexNow.`)
  }
}

const { records: currentRecords, fingerprint: currentFingerprint } = readCurrentCatalog()
// An HTTP 200 on a pre-existing page does not prove that new catalog data is live.
// Wait until the deployed build exposes the exact snapshot we are submitting.
await waitForCatalogDeployment(currentFingerprint)

if (MODE === 'full') {
  const urls = await sitemapUrls(SITEMAP_URL)
  await submitUrls(urls)
  writeBaseline(currentRecords, new Set(urls))
} else {
  const previousRecords = readBaseline()
  const { changedUrls, retiredUrls } = diffCatalogRecords(previousRecords, currentRecords)
  if (changedUrls.length > 0) await waitForChangedPages(changedUrls)
  const urls = [...new Set([...changedUrls, ...retiredUrls])]
  if (urls.length > 0) {
    await submitUrls(urls)
    console.log(`IndexNow delta: ${changedUrls.length} added/updated, ${retiredUrls.length} retired URLs.`)
  } else {
    console.log('No changed or retired indexable repository URLs.')
  }
  writeBaseline(currentRecords)
}
