/** biome-ignore-all lint/style/useNamingConvention: <n8n> */
import { z } from 'zod'
import { getGitHubOwnerUrl, getGitHubRepoUrl, isGitHubSegment } from '../lib/repositoryIdentity.ts'

const _GitHubSegmentSchema = z.string().refine(isGitHubSegment, 'Must be a valid GitHub path segment')

function isValidHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

function urlsMatch(a: string, b: string): boolean {
  try {
    return new URL(a).toString() === new URL(b).toString()
  } catch {
    return a === b
  }
}

export const RepoSchema = z
  .object({
    html_url: z.string().refine(isValidHttpUrl, 'Must be a valid URL'),
    stargazers_count: z.number().nullable(),
    forks_count: z.number().nullable(),
    subscribers_count: z.number().nullable(),
    description: z.string().nullable(),
    owner: z.string().nullable(),
    owner_url: z.string().refine(isValidHttpUrl, 'Must be a valid URL').nullable(),
    repo_name: z.string().nullable(),
    plugins_count: z.number().nullable(),
    plugin_names: z.array(z.string().min(1).max(160)).max(500).optional(),
    plugin_descriptions: z.array(z.string().min(1).max(4_000)).max(500).optional(),
    plugin_categories: z.array(z.string().min(1).max(100)).max(500).optional(),
    plugin_keywords: z.array(z.string().min(1).max(100)).max(2_000).optional(),
    plugin_commands: z.array(z.string().min(1).max(512)).max(2_000).optional(),
    plugin_agents: z.array(z.string().min(1).max(512)).max(2_000).optional(),
    plugin_mcp_servers: z.array(z.string().min(1).max(512)).max(2_000).optional(),
    id: z.number(),
  })
  .superRefine((repo, context) => {
    if (!(repo.owner && repo.repo_name)) {
      return
    }

    if (!urlsMatch(repo.html_url, getGitHubRepoUrl(repo.owner, repo.repo_name))) {
      context.addIssue({
        code: 'custom',
        message: 'Must be the canonical GitHub repository URL',
        path: ['html_url'],
      })
    }

    if (!urlsMatch(repo.owner_url ?? '', getGitHubOwnerUrl(repo.owner))) {
      context.addIssue({
        code: 'custom',
        message: 'Must be the canonical GitHub owner URL',
        path: ['owner_url'],
      })
    }
  })

export const ReposArraySchema = z.array(RepoSchema)

export type Repo = z.infer<typeof RepoSchema>
