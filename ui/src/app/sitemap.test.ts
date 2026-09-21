import { describe, expect, it } from 'vitest'
import { getCatalogLastModified, getIndexableCatalogRepos, getRepoCanonicalPath, searchCatalogRepos } from '../lib/catalog.ts'
import { CATALOG_PAGE_SIZE } from '../lib/catalogPagination.ts'
import { BASE_URL } from '../lib/constants.ts'
import sitemap from './sitemap.ts'

const entries = sitemap()
const urls = entries.map((entry) => entry.url)
const BROWSE_PREFIX = `${BASE_URL}/browse/`

/** The browse route paginates the canonical catalog, so its total is the number the sitemap has to match. */
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

  it('gives every repository url the catalog last-modified date', () => {
    const catalogTimestamp = getCatalogLastModified().getTime()
    const timestampByUrl = new Map(entries.map((entry) => [entry.url, entry.lastModified ? new Date(entry.lastModified).getTime() : null]))
    const repoUrls = getIndexableCatalogRepos().map((repo) => `${BASE_URL}/${getRepoCanonicalPath(repo)}`)
    const wrongDate = repoUrls.filter((url) => timestampByUrl.get(url) !== catalogTimestamp)

    expect(repoUrls.length).toBeGreaterThan(0)
    expect(wrongDate).toHaveLength(0)
  })
})
