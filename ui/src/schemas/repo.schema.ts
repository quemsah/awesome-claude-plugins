/** biome-ignore-all lint/style/useNamingConvention: <n8n> */
import { z } from 'zod'

export const RepoLifecycleStatusSchema = z.enum(['active', 'archived', 'deleted', 'fork', 'mirror', 'renamed', 'stale', 'case_collision'])

export const RepoSchema = z.object({
  html_url: z.string().url(),
  stargazers_count: z.number().nullable(),
  forks_count: z.number().nullable(),
  subscribers_count: z.number().nullable(),
  description: z.string().nullable(),
  owner: z.string().nullable(),
  owner_url: z.string().url().nullable(),
  repo_name: z.string().nullable(),
  plugins_count: z.number().nullable(),
  lifecycle_status: RepoLifecycleStatusSchema.optional(),
  canonical_slug: z.string().nullable().optional(),
  canonical_url: z.string().url().nullable().optional(),
  renamed_from: z.string().nullable().optional(),
  last_seen_at: z.string().datetime().nullable().optional(),
  last_successful_check_at: z.string().datetime().nullable().optional(),
  fork: z.boolean().nullable().optional(),
  archived: z.boolean().nullable().optional(),
  deleted: z.boolean().nullable().optional(),
  mirror_url: z.string().url().nullable().optional(),
  id: z.number(),
})

export const ReposArraySchema = z.array(RepoSchema)

export type Repo = z.infer<typeof RepoSchema>
