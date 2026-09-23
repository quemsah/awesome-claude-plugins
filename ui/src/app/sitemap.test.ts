import { describe, expect, it } from 'vitest'
import { getCatalogLastModified, getIndexableCatalogRepos, getRepoCanonicalPath, searchCatalogRepos } from '../lib/catalog.ts'
import { CATALOG_PAGE_SIZE } from '../lib/catalogPagination.ts'
import { BASE_URL } from '../lib/constants.ts'
import { buildSitemapEntries, getSitemapShard, getSitemapShardCount, SITEMAP_SHARD_SIZE } from '../lib/sitemap.ts'

const entries = buildSitemapEntries()
const urls = entries.map((entry) => entry.url)
const BROWSE_PREFIX = `${BASE_URL}/browse/`

function lastServedBrowsePage(): number {
  const { total } = searchCatalogRepos('', 'stars-desc', 0, CATALOG_PAGE_SIZE)
  return Math.ceil(total / CATALOG_PAGE_SIZE)
}

function listedBrowsePages(): number[] {
  return urls.filter((url) => url.startsWith(BROWSE_PREFIX)).map((url) => Number(url.slice(BROWSE_PREFIX.length)))
}

describe('sitemap', () => {
  it('lists every browse page the browse route serves', () => {
    expect(urls).toContain(`${BROWSE_PREFIX}${lastServedBrowsePage()}`)
  })

  it('lists browse pages contiguously after the home page', () => {
    const lastPage = lastServedBrowsePage()
    const expected = Array.from({ length: Math.max(lastPage - 1, 0) }, (_, index) => index + 2)

    expect(listedBrowsePages()).toEqual(expected)
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

  it('gives every repository url the catalog last-modified date', () => {
    const catalogTimestamp = getCatalogLastModified().getTime()
    const timestampByUrl = new Map(entries.map((entry) => [entry.url, entry.lastModified ? new Date(entry.lastModified).getTime() : null]))
    const repoUrls = getIndexableCatalogRepos().map((repo) => `${BASE_URL}/${getRepoCanonicalPath(repo)}`)
    const wrongDate = repoUrls.filter((url) => timestampByUrl.get(url) !== catalogTimestamp)

    expect(repoUrls.length).toBeGreaterThan(0)
    expect(wrongDate).toHaveLength(0)
  })

  it('splits the full sitemap into bounded shards without dropping urls', () => {
    const shards = Array.from({ length: getSitemapShardCount() }, (_, id) => getSitemapShard(id))

    expect(shards.every((shard) => shard.length <= SITEMAP_SHARD_SIZE)).toBe(true)
    expect(shards.flat().map((entry) => entry.url)).toEqual(urls)
  })
})
