/** biome-ignore-all lint/style/useNamingConvention: external data */
import { z } from 'zod'
import { isGitHubSegment } from '../lib/repositoryIdentity.ts'

const GitHubSegmentSchema = z.string().refine(isGitHubSegment, 'Must be a valid GitHub path segment')

export const RepoSchema = z.object({
  stargazers_count: z.number().nullable(),
  forks_count: z.number().nullable(),
  subscribers_count: z.number().nullable(),
  description: z.string().nullable(),
  owner: GitHubSegmentSchema.nullable(),
  repo_name: GitHubSegmentSchema.nullable(),
  plugins_count: z.number().nullable(),
  catalog_updated_at: z.string().datetime().optional(),
  id: z.number(),
})

export const ReposArraySchema = z.array(RepoSchema)

export type Repo = z.infer<typeof RepoSchema>
