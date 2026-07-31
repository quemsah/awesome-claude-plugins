import { readFileSync } from 'node:fs'

const SITE_URL = process.env.INDEXNOW_SITE_URL ?? 'https://awesomeclaudeplugins.com'
const INDEXNOW_KEY = '14273a4aad028282eac8537cb6ea0e5f'
const SITEMAP_URL = new URL('/sitemap.xml', SITE_URL)
const KEY_LOCATION = new URL(`/${INDEXNOW_KEY}.txt`, SITE_URL).toString()
const MAX_URLS_PER_REQUEST = 10_000

const keyFile = readFileSync(new URL(`../public/${INDEXNOW_KEY}.txt`, import.meta.url), 'utf8').trim()
if (keyFile !== INDEXNOW_KEY) {
  throw new Error(`IndexNow key file does not contain the expected key: ${INDEXNOW_KEY}.txt`)
}

const sitemapResponse = await fetch(SITEMAP_URL)
if (!sitemapResponse.ok) {
  throw new Error(`Failed to fetch ${SITEMAP_URL}: ${sitemapResponse.status} ${sitemapResponse.statusText}`)
}

const sitemap = await sitemapResponse.text()
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
if (urls.length === 0) {
  throw new Error(`No URLs found in ${SITEMAP_URL}`)
}

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
