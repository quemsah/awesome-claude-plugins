import { describe, expect, it } from 'vitest'
import { BASE_URL } from '../lib/constants.ts'
import { buildSitemapEntries, getSitemapShardCount, SITEMAP_SHARD_SIZE } from '../lib/sitemap.ts'
import { GET as getSitemapShard } from './sitemap/[id]/route.ts'
import { GET as getSitemapIndex } from './sitemap.xml/route.ts'

function locations(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
}

describe('sitemap routes', () => {
  it('publishes a root-scoped sitemap index', async () => {
    const response = getSitemapIndex()
    const xml = await response.text()
    const expectedLocations = Array.from({ length: getSitemapShardCount() }, (_, id) => `${BASE_URL}/sitemap-${id}.xml`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/xml')
    expect(xml).toContain('<sitemapindex')
    expect(locations(xml)).toEqual(expectedLocations)
    expect(locations(xml).every((location) => new URL(location).pathname.startsWith('/sitemap-'))).toBe(true)
  })

  it('renders bounded XML shards whose union matches the sitemap entries', async () => {
    const shardUrls: string[] = []

    for (let id = 0; id < getSitemapShardCount(); id += 1) {
      const response = await getSitemapShard(new Request(`${BASE_URL}/sitemap-${id}.xml`), {
        params: Promise.resolve({ id: String(id) }),
      })
      const xml = await response.text()
      const urls = locations(xml)

      expect(response.status).toBe(200)
      expect(xml).toContain('<urlset')
      expect(urls.length).toBeLessThanOrEqual(SITEMAP_SHARD_SIZE)
      shardUrls.push(...urls)
    }

    expect(shardUrls).toEqual(buildSitemapEntries().map((entry) => entry.url))
  })

  it('returns 404 for nonexistent and malformed shard ids', async () => {
    for (const id of ['abc', '-1', String(getSitemapShardCount())]) {
      const response = await getSitemapShard(new Request(`${BASE_URL}/sitemap-${id}.xml`), {
        params: Promise.resolve({ id }),
      })

      expect(response.status, id).toBe(404)
    }
  })
})
