import { gzipSync } from 'node:zlib'

export type SearchIndexV1 = {
  format: 'v1'
  fields: string[]
  rows: unknown[][]
  search: string
}

export type CatalogRecordInput = {
  id: number
  owner?: string | null
  repo_name?: string | null
  stargazers_count?: number | null
  forks_count?: number | null
  plugins_count?: number | null
  plugins?: Array<{ name?: string | null; description?: string | null }>
  plugin_summaries?: Array<{ name?: string; description?: string }>
  plugin_name?: string
  plugin_description?: string
  pushed_at?: string | null
  license?: string | null
  archived?: boolean | null
  catalog_added_at?: string | null
  catalog_updated_at?: string | null
  description?: string | null
  manifest_kind?: 'marketplace' | 'standalone-plugin' | null
  subscribers_count?: number | null
}

export const SEARCH_INDEX_FIELDS = [
  'id',
  'owner',
  'repo_name',
  'stars',
  'forks',
  'plugins_count',
  'pushed_at',
  'license',
  'archived',
  'catalog_added_at',
  'description_quality',
  'catalog_updated_at',
  'description',
  'manifest_kind',
] as const

export function buildSearchIndex(repos: readonly CatalogRecordInput[]): string {
  const rows = repos.map((r) => {
    return [
      r.id,
      r.owner ?? null,
      r.repo_name ?? null,
      r.stargazers_count ?? 0,
      r.forks_count ?? 0,
      r.plugins_count ?? null,
      r.pushed_at ?? null,
      r.license ?? null,
      r.archived ?? /^\[archived\]/i.test(r.description?.trim() ?? ''),
      r.catalog_added_at ?? null,
      r.description?.trim() ? (r.description.trim().length >= 40 ? 2 : 1) : 0,
      r.catalog_updated_at ?? null,
      r.description ?? null,
      r.manifest_kind ?? null,
    ]
  })

  const index: SearchIndexV1 = {
    format: 'v1',
    fields: [...SEARCH_INDEX_FIELDS],
    rows,
    // Descriptions already live in compact rows; avoid inflating them twice
    // while building the FTS index. Plugin metadata is decompressed on demand.
    search: gzipSync(
      JSON.stringify(
        repos.map((r) => ({
          plugins: r.plugins,
          plugin_summaries: r.plugin_summaries,
          plugin_name: r.plugin_name,
          plugin_description: r.plugin_description,
        })),
      ),
    ).toString('base64'),
  }
  return JSON.stringify(index)
}

export function buildRepoDetailsShards(repos: readonly CatalogRecordInput[], numShards = 100): Record<string, string> {
  const shards: Record<number, Record<number, Record<string, unknown>>> = {}
  for (let i = 0; i < numShards; i++) {
    shards[i] = {}
  }

  for (const r of repos) {
    const shardId = Math.abs(Number(r.id) % numShards)
    const previous = shards[shardId][r.id]
    if (previous) {
      // Case-only aliases of one GitHub repository must preserve the first canonical record.
      // The same id for a different path is invalid and must not silently overwrite details.
      const key = (record: { owner?: unknown; repo_name?: unknown }) =>
        `${String(record.owner ?? '').toLowerCase()}/${String(record.repo_name ?? '').toLowerCase()}`
      if (key(previous) !== key(r)) {
        throw new Error(`Conflicting repository identity for GitHub id ${r.id}`)
      }
      continue
    }
    shards[shardId][r.id] = { ...r }
  }

  const result: Record<string, string> = {}
  for (let i = 0; i < numShards; i++) {
    result[`${i}.json`] = JSON.stringify(shards[i])
  }
  return result
}
