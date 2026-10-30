/** biome-ignore-all lint/style/useNamingConvention: external data */
import { z } from 'zod'
import { isGitHubSegment } from '../lib/repositoryIdentity.ts'

// Match crawler validation: dot-only segments are not repository identities.
const GitHubSegmentSchema = z
  .string()
  .refine((value) => value !== '.' && value !== '..' && isGitHubSegment(value), 'Must be a valid GitHub path segment')

export const RepoSchema = z.object({
  stargazers_count: z.number().nullable(),
  forks_count: z.number().nullable(),
  subscribers_count: z.number().nullable(),
  description: z.string().nullable(),
  owner: GitHubSegmentSchema.nullable(),
  repo_name: GitHubSegmentSchema.nullable(),
  plugins_count: z.number().nullable(),
  id: z.number(),
})

export const ReposArraySchema = z.array(RepoSchema)

export type Repo = z.infer<typeof RepoSchema>
