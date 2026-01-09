/** biome-ignore-all lint/style/useNamingConvention: <n8n> */
import type { MetadataRoute } from 'next'
import reposData from '../data/repos.json' with { type: 'json' }
import { BASE_URL } from '../lib/constants.ts'
import { type Repo, ReposArraySchema } from '../schemas/repo.schema.ts'

function isValidRepo(repo: Repo): repo is Repo & { owner: string; repo_name: string } {
  return repo.owner !== null && repo.repo_name !== null
}

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  let repos: (Repo & { owner: string; repo_name: string })[] = []

  try {
    const validationResult = ReposArraySchema.safeParse(reposData)
    if (validationResult.success) {
      repos = validationResult.data.filter(isValidRepo) as (Repo & { owner: string; repo_name: string })[]
    } else {
      console.error('Failed to validate repositories for sitemap:', validationResult.error)
    }
  } catch (error) {
    console.error('Failed to load repositories for sitemap:', error)
  }

  const repoUrls: MetadataRoute.Sitemap = repos.map((repo) => ({
    url: `${BASE_URL}/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo_name)}`,
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
