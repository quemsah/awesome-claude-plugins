/** biome-ignore-all lint/style/useNamingConvention: external catalog fields */
import { describe, expect, it } from 'vitest'
import { getCatalogLastModified, getIndexableCatalogRepos, getRepoCanonicalPath } from '../lib/catalog.ts'
import { BASE_URL } from '../lib/constants.ts'
import {
  buildSitemapEntries,
  getRepoSitemapLastModified,
  getSitemapShard,
  getSitemapShardCount,
  SITEMAP_SHARD_SIZE,
} from '../lib/sitemap.ts'

const entries = buildSitemapEntries()
const urls = entries.map((entry) => entry.url)
const BROWSE_PREFIX = `${BASE_URL}/browse/`

describe('sitemap', () => {
  it('keeps paginated browse routes out of the sitemap', () => {
    expect(urls.some((url) => url.startsWith(BROWSE_PREFIX))).toBe(false)
  })

  it('orders repository urls by stars descending', () => {
    const expectedRepoUrls = [...getIndexableCatalogRepos()]
      .sort(
        (left, right) =>
          (right.stargazers_count ?? 0) - (left.stargazers_count ?? 0) ||
          Number(Boolean(right.description?.trim())) - Number(Boolean(left.description?.trim()))
      )
      .map((repo) => `${BASE_URL}/${getRepoCanonicalPath(repo)}`)
    const repoUrlSet = new Set(expectedRepoUrls)

    expect(urls.filter((url) => repoUrlSet.has(url))).toEqual(expectedRepoUrls)
  })

  it('uses each repository catalog timestamp for lastmod', () => {
    const catalogTimestamp = getCatalogLastModified().getTime()
    const timestampByUrl = new Map(entries.map((entry) => [entry.url, entry.lastModified ? new Date(entry.lastModified).getTime() : null]))
    const datedRepo = getIndexableCatalogRepos().find((repo) => repo.catalog_updated_at)
    const legacyRepo = getIndexableCatalogRepos().find((repo) => !repo.catalog_updated_at)

    expect(getIndexableCatalogRepos().length).toBeGreaterThan(0)
    if (datedRepo) {
      expect(timestampByUrl.get(`${BASE_URL}/${getRepoCanonicalPath(datedRepo)}`)).toBe(
        new Date(datedRepo.catalog_updated_at as string).getTime()
      )
    }
    if (legacyRepo) {
      expect(timestampByUrl.get(`${BASE_URL}/${getRepoCanonicalPath(legacyRepo)}`)).toBe(catalogTimestamp)
    }
    expect(getRepoSitemapLastModified({ catalog_updated_at: '2025-02-03T04:05:06.789Z' })).toEqual(new Date('2025-02-03T04:05:06.789Z'))
  })

  it('splits the full sitemap into bounded shards without dropping urls', () => {
    const shards = Array.from({ length: getSitemapShardCount() }, (_, id) => getSitemapShard(id))

    expect(shards.every((shard) => shard.length <= SITEMAP_SHARD_SIZE)).toBe(true)
    expect(shards.flat().map((entry) => entry.url)).toEqual(urls)
  })
})
