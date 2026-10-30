import type { z } from 'zod'

/** Exact published record accepted by the crawler; URLs are derived from identity. */
export type CatalogRecord = {
  stargazers_count: number
  forks_count: number
  subscribers_count: number
  description: string | null
  owner: string
  repo_name: string
  plugins_count: number | null
  plugins?: { name?: string; description?: string }[]
  catalog_updated_at: string
  id: number
}

/** Display model: API rows may include partial metadata and optional agent summaries. */
export type Repo = {
  stargazers_count: number | null
  forks_count: number | null
  subscribers_count: number | null
  description: string | null
  owner: string | null
  repo_name: string | null
  plugins_count: number | null
  plugins?: { name?: string; description?: string }[]
  plugin_name?: string
  plugin_description?: string
  plugin_summaries?: { name?: string; description?: string }[]
  catalog_updated_at?: string
  id: number
}

export declare const PluginSummarySchema: z.ZodType<{ name?: string; description?: string }>
export declare const RepoSchema: z.ZodType<Repo>
export declare const ReposArraySchema: z.ZodType<Repo[]>
export declare const PublishedRepoSchema: z.ZodType<CatalogRecord>
export declare const PublishedReposArraySchema: z.ZodType<CatalogRecord[]>
