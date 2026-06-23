/** biome-ignore-all lint/style/useNamingConvention: <n8n> */
import type { MetadataRoute } from 'next'
import { getCatalogLastModified, getCatalogRepos, getRepoCanonicalPath, getRepoSitemapPriority } from '../lib/catalog.ts'
import { BASE_URL } from '../lib/constants.ts'

export default function sitemap(): MetadataRoute.Sitemap {
  const catalogLastModified = getCatalogLastModified()
  const repos = getCatalogRepos()

  const repoUrls: MetadataRoute.Sitemap = repos.map((repo) => ({
    url: `${BASE_URL}/${getRepoCanonicalPath(repo)}`,
    lastModified: catalogLastModified,
    changeFrequency: repo.plugins_count === null ? 'monthly' : 'weekly',
    priority: getRepoSitemapPriority(repo),
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
    ...repoUrls,
  ]
}
