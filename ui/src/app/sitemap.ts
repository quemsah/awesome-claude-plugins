/** biome-ignore-all lint/style/useNamingConvention: <n8n> */
import type { MetadataRoute } from 'next'
import {
  getCanonicalCatalogRepos,
  getCatalogLastModified,
  getCatalogRepos,
  getRepoCanonicalPath,
  getRepoSitemapPriority,
} from '../lib/catalog.ts'
import { CATALOG_PAGE_SIZE } from '../lib/catalogPagination.ts'
import { BASE_URL } from '../lib/constants.ts'

export default function sitemap(): MetadataRoute.Sitemap {
  const catalogLastModified = getCatalogLastModified()
  const totalBrowsePages = Math.ceil(getCatalogRepos().length / CATALOG_PAGE_SIZE)

  const repoUrls: MetadataRoute.Sitemap = getCanonicalCatalogRepos().map((repo) => ({
    url: `${BASE_URL}/${getRepoCanonicalPath(repo)}`,
    lastModified: catalogLastModified,
    changeFrequency: repo.plugins_count === null ? 'monthly' : 'weekly',
    priority: getRepoSitemapPriority(repo),
  }))
  const browseUrls: MetadataRoute.Sitemap = Array.from({ length: Math.max(totalBrowsePages - 1, 0) }, (_, index) => ({
    url: `${BASE_URL}/browse/${index + 2}`,
    lastModified: catalogLastModified,
    changeFrequency: 'daily',
    priority: 0.6,
  }))

  return [
    {
      url: `${BASE_URL}/`,
      lastModified: catalogLastModified,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/stats`,
      lastModified: catalogLastModified,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/about`,
      lastModified: catalogLastModified,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/privacy`,
      lastModified: catalogLastModified,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    ...browseUrls,
    ...repoUrls,
  ]
}
