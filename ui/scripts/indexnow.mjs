import { readFileSync } from 'node:fs'

const SITE_URL = process.env.INDEXNOW_SITE_URL ?? 'https://awesomeclaudeplugins.com'
const SITEMAP_URL = new URL('/sitemap.xml', SITE_URL)
const INDEXNOW_KEY = '14273a4aad028282eac8537cb6ea0e5f'
const KEY_LOCATION = new URL(`/${INDEXNOW_KEY}.txt`, SITE_URL).toString()
const MAX_URLS_PER_REQUEST = 10_000

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

const urls = await sitemapUrls(SITEMAP_URL)

for (let offset = 0; offset < urls.length; offset += MAX_URLS_PER_REQUEST) {
  const urlList = urls.slice(offset, offset + MAX_URLS_PER_REQUEST)
  const response = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: new URL(SITE_URL).host,
      key: INDEXNOW_KEY,
      keyLocation: KEY_LOCATION,
      urlList,
    }),
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`IndexNow rejected the request: ${response.status} ${response.statusText}${details ? ` - ${details}` : ''}`)
  }

  console.log(`Submitted ${urlList.length} URL${urlList.length === 1 ? '' : 's'} to IndexNow.`)
}
