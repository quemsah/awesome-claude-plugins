import { expect, test } from '@playwright/test'

const sitemapShardPathPattern = /^\/sitemap-\d+\.xml$/

function locations(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
}

test('sitemap index exposes reachable root-scoped XML shards', async ({ request }) => {
  const indexResponse = await request.get('/sitemap.xml')
  const indexXml = await indexResponse.text()
  const shardLocations = locations(indexXml)

  expect(indexResponse.status()).toBe(200)
  expect(indexXml).toContain('<sitemapindex')
  expect(shardLocations.length).toBeGreaterThan(0)

  for (const location of shardLocations) {
    const url = new URL(location)
    expect(url.pathname).toMatch(sitemapShardPathPattern)
  }

  const firstShard = await request.get(new URL(shardLocations[0]).pathname)
  const firstShardXml = await firstShard.text()

  expect(firstShard.status()).toBe(200)
  expect(firstShardXml).toContain('<urlset')
  expect(locations(firstShardXml).length).toBeGreaterThan(0)
})

test('nonexistent sitemap shard returns 404', async ({ request }) => {
  const response = await request.get('/sitemap-99999.xml')

  expect(response.status()).toBe(404)
})
