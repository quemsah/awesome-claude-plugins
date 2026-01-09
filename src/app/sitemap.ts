import type { MetadataRoute } from 'next'
import reposData from '../data/repos.json' with { type: 'json' }
import { BASE_URL } from '../lib/constants.ts'
import { type Repo, ReposArraySchema } from '../schemas/repo.schema.ts'

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  let repos: Repo[] = []

  try {
    const validationResult = ReposArraySchema.safeParse(reposData)
    if (validationResult.success) {
      repos = validationResult.data.filter((repo) => repo.repo_name !== null && repo.owner !== null)
    } else {
      console.error(
        'Failed to validate repositories for sitemap:',
        validationResult.error,
      )
    }
  } catch (error) {
    console.error('Failed to load repositories for sitemap:', error)
  }

  const repoUrls: MetadataRoute.Sitemap = repos.map((repo) => ({
    url: `${BASE_URL}/${repo.owner}/${repo.repo_name}`,
    lastModified: now,
    changeFrequency: 'weekly',
    priority: 0.5,
  }))

  return [
    {
      url: `${BASE_URL}/`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/stats`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    ...repoUrls,
  ]
}
