/** biome-ignore-all lint/style/useNamingConvention: <n8n> */
import { z } from 'zod'

export const RepoVerificationStatusSchema = z.enum(['verified', 'discovered', 'unavailable', 'stale', 'invalid'])
export const RepoMarketplaceStatusSchema = z.enum(['found', 'not_found', 'unavailable', 'stale', 'invalid'])

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
  id: z.number(),
  discovery_reason: z.string().nullable().optional(),
  verification_status: RepoVerificationStatusSchema.nullable().optional(),
  last_verified_at: z.string().datetime().nullable().optional(),
  marketplace_url: z.string().url().nullable().optional(),
  marketplace_status: RepoMarketplaceStatusSchema.nullable().optional(),
})

export const ReposArraySchema = z.array(RepoSchema)

export type Repo = z.infer<typeof RepoSchema>
