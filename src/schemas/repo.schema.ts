/** biome-ignore-all lint/style/useNamingConvention: <n8n> */
import { z } from 'zod'

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
})

export const ReposArraySchema = z.array(RepoSchema)

export type Repo = z.infer<typeof RepoSchema>
