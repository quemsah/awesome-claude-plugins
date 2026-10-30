import type { z } from 'zod'

export type PluginSummary = { name?: string; description?: string }

/** Exact published record accepted by the crawler; URLs are derived from identity. */
export type CatalogRecord = {
  stargazers_count: number
  forks_count: number
  subscribers_count: number
  description: string | null
  owner: string
  repo_name: string
  plugins_count: number | null
  plugins?: PluginSummary[]
  catalog_updated_at: string
  pushed_at?: string | null
  created_at?: string | null
  license?: string | null
  archived?: boolean | null
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
  plugins?: PluginSummary[]
  plugin_name?: string
  plugin_description?: string
  plugin_summaries?: PluginSummary[]
  catalog_updated_at?: string
  pushed_at?: string | null
  created_at?: string | null
  license?: string | null
  archived?: boolean | null
  id: number
}

export declare const PluginSummarySchema: z.ZodType<PluginSummary>
export declare const RepoSchema: z.ZodType<Repo>
export declare const ReposArraySchema: z.ZodType<Repo[]>
export declare const PublishedRepoSchema: z.ZodType<CatalogRecord>
export declare const PublishedReposArraySchema: z.ZodType<CatalogRecord[]>
