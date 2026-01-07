import type { MetadataRoute } from 'next'
import { BASE_URL } from '../lib/constants.ts'
import reposData from '../data/repos.json' with { type: 'json' }
import { type Repo, ReposArraySchema } from '../schemas/repo.schema.ts'

export default function sitemap(): MetadataRoute.Sitemap {
  let repos: Repo[] = []

  try {
    const validationResult = ReposArraySchema.safeParse(reposData)
    if (validationResult.success) {
      repos = validationResult.data.filter((repo) => repo.repo_name !== null)
    }
  } catch (error) {
    console.error('Failed to load repositories for sitemap:', error)
  }

  const repoUrls: MetadataRoute.Sitemap = repos.map((repo) => ({
    url: `${BASE_URL}/${repo.owner}/${repo.repo_name}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: 0.5,
  }))

  return [
    {
      url: `${BASE_URL}/`,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/stats`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    },
    ...repoUrls,
  ]
}
