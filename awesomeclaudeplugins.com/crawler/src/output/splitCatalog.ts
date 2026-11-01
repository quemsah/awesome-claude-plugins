export type SearchIndexV1 = {
  format: 'v1'
  fields: string[]
  rows: (string | number | boolean | null | string[])[][]
}

export type CatalogRecordInput = {
  id: number
  owner?: string | null
  repo_name?: string | null
  stargazers_count?: number | null
  forks_count?: number | null
  plugins_count?: number | null
  plugins?: Array<{ name?: string | null; description?: string | null }>
  pushed_at?: string | null
  license?: string | null
  archived?: boolean | null
  catalog_added_at?: string | null
  catalog_updated_at?: string | null
  description?: string | null
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
  'tokens',
  'has_desc',
] as const

export function buildSearchIndex(repos: readonly CatalogRecordInput[]): string {
  const rows = repos.map((r) => {
    const tokens = r.plugins
      ? r.plugins
          .map((p) => p?.name)
          .filter(
            (n): n is string =>
              Boolean(n) &&
              typeof n === 'string' &&
              n.toLowerCase() !== (r.repo_name || '').toLowerCase() &&
              n.toLowerCase() !== (r.owner || '').toLowerCase(),
          )
          .slice(0, 3)
      : []

    return [
      r.id,
      r.owner ?? null,
      r.repo_name ?? null,
      r.stargazers_count ?? 0,
      r.forks_count ?? 0,
      r.plugins_count ?? null,
      r.pushed_at ? String(r.pushed_at).slice(0, 10) : null,
      r.license ?? null,
      r.archived ? 1 : 0,
      r.catalog_added_at ? String(r.catalog_added_at).slice(0, 10) : null,
      tokens.length > 0 ? tokens : null,
      r.description && String(r.description).trim().length > 0 ? 1 : 0,
    ]
  })

  const index: SearchIndexV1 = {
    format: 'v1',
    fields: [...SEARCH_INDEX_FIELDS],
    rows,
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
    shards[shardId][r.id] = {
      description: r.description ?? null,
      plugins: r.plugins ?? [],
      subscribers_count: r.subscribers_count ?? null,
      catalog_updated_at: r.catalog_updated_at,
      pushed_at: r.pushed_at ?? null,
      catalog_added_at: r.catalog_added_at ?? null,
      license: r.license ?? null,
    }
  }

  const result: Record<string, string> = {}
  for (let i = 0; i < numShards; i++) {
    result[`${i}.json`] = JSON.stringify(shards[i])
  }
  return result
}
