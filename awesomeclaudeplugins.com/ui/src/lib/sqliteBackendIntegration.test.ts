import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GET as getCatalog } from '../app/api/catalog/route.ts'
import { GET as getFeedJson } from '../app/feed.json/route.ts'
import { GET as getLlmsTxt } from '../app/llms.txt/route.ts'
import {
  findCatalogRepo,
  getCatalogBackend,
  getCatalogCanonicalCount,
  getCatalogLastModified,
  getPublishedCatalogSummary,
  getStatsHistory,
  searchCatalogRepos,
} from './catalog.ts'
import { isRepoPageEndingInMd } from './markdownPaths.ts'
import { getSitemapEntryCount, getSitemapShard, getSitemapShardCount } from './sitemap.ts'
import { sqliteCloseCatalog, sqliteGetCatalogVersionHash } from './sqliteCatalogStore.ts'

const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/
const SITEMAP_URL_REGEX = /^https:\/\/awesomeclaudeplugins\.com\//

describe('CATALOG_BACKEND=sqlite full UI integration tests', () => {
  const originalBackend = process.env.CATALOG_BACKEND

  beforeAll(async () => {
    process.env.CATALOG_BACKEND = 'sqlite'
    const dbPath = join(process.cwd(), 'src/data/catalog.sqlite')
    if (!existsSync(dbPath)) {
      const { prepareCatalog } = await import('../../scripts/prepare-catalog.mjs')
      await prepareCatalog()
    }
  }, 30000)

  afterAll(() => {
    if (originalBackend !== undefined) {
      process.env.CATALOG_BACKEND = originalBackend
    } else {
      delete process.env.CATALOG_BACKEND
    }
    sqliteCloseCatalog()
  })

  it('verifies active backend is sqlite', () => {
    expect(getCatalogBackend()).toBe('sqlite')
  })

  it('returns canonical catalog count from SQLite without loading legacy array', () => {
    const count = getCatalogCanonicalCount()
    expect(count).toBeGreaterThan(50000)
  })

  it('serves /api/catalog route with search, sorting, and pagination in SQLite mode', async () => {
    const url = new URL('http://localhost/api/catalog?q=claude&sort=stars-desc&page=0&pageSize=12')
    const request = new Request(url, { headers: { 'x-real-ip': 'sqlite-test-1' } })
    const response = await getCatalog(request)
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.total).toBeGreaterThan(0)
    expect(data.repos.length).toBe(12)
    expect(data.hasMore).toBe(true)
    expect(data.pluginsCount).toBeGreaterThan(0)
  })

  it('serves /api/catalog-version route with snapshot hash in SQLite mode', async () => {
    const { GET: getCatalogVersion } = await import('../app/api/catalog-version/route.ts')
    const response = await getCatalogVersion()
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.sha256).toMatch(SHA256_HEX_REGEX)
    expect(json.sha256).toBe(sqliteGetCatalogVersionHash())
  })

  it('serves /feed.json route using SQLite catalog summary', async () => {
    const response = await getFeedJson()
    expect(response.status).toBe(200)
    const feed = await response.json()
    expect(feed.version).toBe('https://jsonfeed.org/version/1.1')
    expect(feed.title).toBe('Awesome Claude Plugins')
    expect(feed.items.length).toBeGreaterThan(0)
    expect(feed.items[0].content_text).toContain('repositories')
  })

  it('serves /llms.txt route using SQLite catalog summary', async () => {
    const response = await getLlmsTxt()
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain('# Awesome Claude Plugins')
    expect(text).toContain(`Repositories indexed: ${getCatalogCanonicalCount()}`)
  })

  it('provides stats history directly from SQLite', () => {
    const stats = getStatsHistory()
    expect(Array.isArray(stats)).toBe(true)
    expect(stats.length).toBeGreaterThan(100)
    expect(stats[0]).toHaveProperty('date')
    expect(stats[0]).toHaveProperty('size')
  })

  it('provides sitemap shards and entries via SQLite pagination', () => {
    const shardCount = getSitemapShardCount()
    expect(shardCount).toBeGreaterThan(0)

    const entryCount = getSitemapEntryCount()
    expect(entryCount).toBeGreaterThan(50000)

    const firstShard = getSitemapShard(0)
    expect(firstShard.length).toBeGreaterThan(0)
    expect(firstShard[0].url).toMatch(SITEMAP_URL_REGEX)
    expect(firstShard[0].lastModified).toBeInstanceOf(Date)
  })

  it('evaluates markdown repo paths using direct SQLite connection', () => {
    expect(isRepoPageEndingInMd('sstklen/yes.md')).toBe(true)
    expect(isRepoPageEndingInMd('sstklen/yes')).toBe(false)
    expect(isRepoPageEndingInMd('foo/bar')).toBe(false)
  })

  it('retrieves single repo details via findCatalogRepo in SQLite mode', () => {
    const searchRes = searchCatalogRepos('', 'stars-desc', 0, 1)
    expect(searchRes.repos.length).toBe(1)
    const topRepo = searchRes.repos[0]

    const path = `${topRepo.owner}/${topRepo.repo_name}`
    const found = findCatalogRepo(path)
    expect(found).toBeDefined()
    expect(found?.owner).toBe(topRepo.owner)
    expect(found?.repo_name).toBe(topRepo.repo_name)
  })

  it('retrieves catalog last modified date from SQLite snapshot metadata', () => {
    const lastModified = getCatalogLastModified()
    expect(lastModified).toBeInstanceOf(Date)
    expect(lastModified.getTime()).toBeGreaterThan(0)
  })

  it('generates published catalog summary correctly from SQLite', () => {
    const summary = getPublishedCatalogSummary()
    expect(summary.repoCount).toBeGreaterThan(50000)
    expect(summary.pluginCount).toBeGreaterThan(100000)
  })
})
