/** biome-ignore-all lint/style/useNamingConvention: <n8n> */
import { z } from 'zod'
import { getGitHubOwnerUrl, getGitHubRepoUrl, isGitHubSegment } from '../lib/repositoryIdentity.ts'

const GitHubSegmentSchema = z.string().refine(isGitHubSegment, 'Must be a valid GitHub path segment')

export const RepoSchema = z
  .object({
    html_url: z.string().url(),
    stargazers_count: z.number().nullable(),
    forks_count: z.number().nullable(),
    subscribers_count: z.number().nullable(),
    description: z.string().nullable(),
    owner: z.string().nullable(),
    owner_url: z.string().url().nullable(),
    repo_name: z.string().nullable(),
    plugins_count: z.number().nullable(),
    id: z.number(),
  })
  .superRefine((repo, context) => {
    if (!repo.owner || !repo.repo_name) {
      return
    }

    if (repo.html_url !== getGitHubRepoUrl(repo.owner, repo.repo_name)) {
      context.addIssue({
        code: 'custom',
        message: 'Must be the canonical GitHub repository URL',
        path: ['html_url'],
      })
    }

    if (repo.owner_url !== getGitHubOwnerUrl(repo.owner)) {
      context.addIssue({
        code: 'custom',
        message: 'Must be the canonical GitHub owner URL',
        path: ['owner_url'],
      })
    }
  })

export const ReposArraySchema = z.array(RepoSchema)

export type Repo = z.infer<typeof RepoSchema>
