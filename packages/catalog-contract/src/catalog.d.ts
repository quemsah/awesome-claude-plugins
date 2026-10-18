import type { z } from 'zod'

/** Exact public catalog record shape accepted for publication. */
export type CatalogRecord = {
  html_url: string
  stargazers_count: number
  forks_count: number
  subscribers_count: number
  description: string | null
  owner: string
  owner_url: string
  repo_name: string
  plugins_count: number | null
  id: number
}

/** UI-facing model retained for callers that represent incomplete repository metadata. */
export type Repo = {
  html_url: string
  stargazers_count: number | null
  forks_count: number | null
  subscribers_count: number | null
  description: string | null
  owner: string | null
  owner_url: string | null
  repo_name: string | null
  plugins_count: number | null
  id: number
}

export declare const RepoSchema: z.ZodType<CatalogRecord>
export declare const ReposArraySchema: z.ZodType<CatalogRecord[]>
