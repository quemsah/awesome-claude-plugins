/** biome-ignore-all lint/style/useNamingConvention: external data */
import type { MetadataRoute } from 'next'
import { getBrowsePageCount, getCatalogLastModified, getIndexableCatalogRepos, getRepoCanonicalPath } from '../lib/catalog.ts'
import { BASE_URL } from '../lib/constants.ts'

export default function sitemap(): MetadataRoute.Sitemap {
  const catalogLastModified = getCatalogLastModified()
  const totalBrowsePages = getBrowsePageCount()

  const repoUrls: MetadataRoute.Sitemap = getIndexableCatalogRepos().map((repo) => ({
    url: `${BASE_URL}/${getRepoCanonicalPath(repo)}`,
    lastModified: catalogLastModified,
  }))
  const browseUrls: MetadataRoute.Sitemap = Array.from({ length: Math.max(totalBrowsePages - 1, 0) }, (_, index) => ({
    url: `${BASE_URL}/browse/${index + 2}`,
    lastModified: catalogLastModified,
  }))

  return [
    {
      url: `${BASE_URL}/`,
      lastModified: catalogLastModified,
    },
    {
      url: `${BASE_URL}/stats`,
      lastModified: catalogLastModified,
    },
    {
      url: `${BASE_URL}/about`,
    },
    {
      url: `${BASE_URL}/privacy`,
    },
    ...browseUrls,
    ...repoUrls,
  ]
}
