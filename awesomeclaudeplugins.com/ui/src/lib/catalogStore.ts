/** biome-ignore-all lint/style/useNamingConvention: catalog data uses snake_case fields */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { Repo } from '../schemas/repo.schema.ts'

const CATALOG_KEY = Symbol.for('awesome-claude-plugins.catalog')
const SHARD_CACHE_KEY = Symbol.for('awesome-claude-plugins.shard-cache')
const FALLBACK_REPOS_KEY = Symbol.for('awesome-claude-plugins.canonical-fallback')

type ShardCache = Map<number, Record<string, Partial<Repo>>>
type CatalogGlobal = typeof globalThis & {
  [CATALOG_KEY]?: readonly Repo[]
  [SHARD_CACHE_KEY]?: ShardCache
  [FALLBACK_REPOS_KEY]?: Map<number, Repo[]> | null
}

export type SearchIndexV1 = {
  format: 'v1'
  fields: string[]
  rows: unknown[][]
  search: string
}

// Search rows use positional fields: reject even a reordered V1 schema.
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

function isValidSearchIndex(value: unknown): value is SearchIndexV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const index = value as Partial<SearchIndexV1>
  return (
    index.format === 'v1' &&
    Array.isArray(index.fields) &&
    index.fields.length === SEARCH_INDEX_FIELDS.length &&
    index.fields.every((field, i) => field === SEARCH_INDEX_FIELDS[i]) &&
    Array.isArray(index.rows) &&
    index.rows.every((row) => Array.isArray(row) && row.length === SEARCH_INDEX_FIELDS.length && Number.isSafeInteger(row[0])) &&
    typeof index.search === 'string' &&
    index.search.length > 0
  )
}

export function parseSearchIndex(content: string | SearchIndexV1): Repo[] {
  const parsed: unknown = typeof content === 'string' ? JSON.parse(content) : content
  if (!isValidSearchIndex(parsed)) throw new Error('Incompatible compact catalog format')
  return parsed.rows.map((row, searchRow) => {
      const id = row[0] as number
      const owner = row[1] as string
      const repo_name = row[2] as string
      const stargazers_count = (row[3] as number) ?? 0
      const forks_count = (row[4] as number) ?? 0
      const plugins_count = (row[5] as number | null) ?? null
      const pushed_at = (row[6] as string | null) ?? null
      const license = (row[7] as string | null) ?? null
      const archived = (row[8] as boolean | null) ?? null
      const catalog_added_at = (row[9] as string | null) ?? null
      const description = (row[12] as string | null) ?? null
      const manifest_kind = (row[13] as Repo['manifest_kind']) ?? undefined

      const record = {
        id,
        owner,
        repo_name,
        stargazers_count,
        forks_count,
        plugins_count,
        pushed_at,
        license,
        archived,
        catalog_added_at,
        description,
        manifest_kind,
        catalog_updated_at: (row[11] as string | null) ?? undefined,
        subscribers_count: null,
      } as Repo
      // FTS metadata must not leak into the public API or client-side React props.
      return Object.defineProperty(record, 'searchRow', { value: searchRow, enumerable: false })
  })
}

/** Recover invalid derived artifacts from the authoritative repos.json snapshot. */
export function readCatalogFiles(indexPath: string, reposPath: string): Repo[] {
  if (existsSync(indexPath)) {
    try {
      return parseSearchIndex(readFileSync(indexPath, 'utf8'))
    } catch {
      // A missing, truncated or incompatible index must not take down the catalog.
    }
  }
  if (existsSync(reposPath)) {
    const repos: unknown = JSON.parse(readFileSync(reposPath, 'utf8'))
    if (!Array.isArray(repos)) throw new Error('Invalid canonical repository snapshot')
    return repos as Repo[]
  }
  if (existsSync(indexPath)) throw new Error('Invalid compact catalog and no canonical repository snapshot')
  return []
}

export function getCatalog(): readonly Repo[] {
  const root = globalThis as CatalogGlobal
  const cachedCatalog = root[CATALOG_KEY]
  if (cachedCatalog !== undefined) return cachedCatalog

  const catalog = readCatalogFiles(join(process.cwd(), 'src/data/search-index.json'), join(process.cwd(), 'src/data/repos.json'))
  root[CATALOG_KEY] = catalog
  return catalog
}

function getShardCache(): ShardCache {
  const root = globalThis as CatalogGlobal
  if (!root[SHARD_CACHE_KEY]) {
    root[SHARD_CACHE_KEY] = new Map()
  }
  return root[SHARD_CACHE_KEY]
}

// A broken or absent shard must not trigger a full 42 MB JSON parse per record.
// Reuse the canonical snapshot only on the exceptional recovery path.
function getCanonicalFallback(): Map<number, Repo[]> | null {
  const root = globalThis as CatalogGlobal
  if (root[FALLBACK_REPOS_KEY] !== undefined) return root[FALLBACK_REPOS_KEY]
  const path = join(process.cwd(), 'src/data/repos.json')
  if (!existsSync(path)) {
    root[FALLBACK_REPOS_KEY] = null
    return null
  }
  try {
    const repos = JSON.parse(readFileSync(path, 'utf8')) as Repo[]
    if (!Array.isArray(repos)) throw new Error('Invalid repository snapshot')
    const lookup = new Map<number, Repo[]>()
    for (const repo of repos) {
      const matches = lookup.get(repo.id)
      if (matches) matches.push(repo)
      else lookup.set(repo.id, [repo])
    }
    root[FALLBACK_REPOS_KEY] = lookup
  } catch {
    root[FALLBACK_REPOS_KEY] = null
  }
  return root[FALLBACK_REPOS_KEY]
}

function matchesIdentity(repo: Partial<Repo>, id: number, owner?: string | null, repoName?: string | null): boolean {
  return (
    repo.id === id &&
    (owner == null || repo.owner?.toLowerCase() === owner.toLowerCase()) &&
    (repoName == null || repo.repo_name?.toLowerCase() === repoName.toLowerCase())
  )
}

/** Bounded LRU: touch a hit so frequently used detail buckets are not evicted. */
export function getRepoDetails(id: number, owner?: string | null, repoName?: string | null): Partial<Repo> | null {
  const shardId = Math.abs(id % 100)
  const cache = getShardCache()
  let shard = cache.get(shardId)

  if (shard !== undefined) {
    cache.delete(shardId)
    cache.set(shardId, shard)
  } else {
    const shardPath = join(process.cwd(), `src/data/repo-details/${shardId}.json`)
    if (existsSync(shardPath)) {
      try {
        shard = JSON.parse(readFileSync(shardPath, 'utf8')) as Record<string, Partial<Repo>>
        if (cache.size >= 10) {
          const oldestKey = cache.keys().next().value
          if (oldestKey !== undefined) cache.delete(oldestKey)
        }
        cache.set(shardId, shard)
      } catch {
        // A corrupt shard is equivalent to a missing shard: recover from repos.json.
      }
    }
  }

  const details = shard?.[id]
  if (details && matchesIdentity(details, id, owner, repoName)) return details

  // Parse the canonical snapshot once across all missing/corrupt shard reads.
  const canonical = getCanonicalFallback()
  return canonical?.get(id)?.find((record) => matchesIdentity(record, id, owner, repoName)) ?? null
}

export function hydrateCatalogRepo<T extends Repo>(repo: T): T {
  // Canonical fallback records are already complete; shards may be stale.
  if (!isSearchCatalogRepo(repo)) return repo
  const details = getRepoDetails(repo.id, repo.owner, repo.repo_name)
  if (details) return details as T
  if (isSearchCatalogRepo(repo)) {
    throw new Error(`Missing repository details for ${repo.owner}/${repo.repo_name} (${repo.id})`)
  }
  return repo
}

export type SearchCatalogRepo = Repo & { searchRow: number }

export function isSearchCatalogRepo(repo: Repo): repo is SearchCatalogRepo {
  return 'searchRow' in repo
}

/** Transient search fields: decoded only when the FTS index is first constructed. */
export function readCatalogSearchFields(
  indexPath = join(process.cwd(), 'src/data/search-index.json'),
  reposPath = join(process.cwd(), 'src/data/repos.json'),
  expectedCount = getCatalog().length
): Partial<Repo>[] {
  try {
    const index: unknown = JSON.parse(readFileSync(indexPath, 'utf8'))
    if (!isValidSearchIndex(index)) throw new Error('Invalid search index schema')
    const fields: unknown = JSON.parse(gunzipSync(Buffer.from(index.search, 'base64')).toString('utf8'))
    if (!Array.isArray(fields) || fields.length !== index.rows.length || fields.length !== expectedCount) {
      throw new Error('Misaligned search metadata')
    }
    return fields as Partial<Repo>[]
  } catch {
    // Corrupt compressed metadata must not disable plugin-name search. This
    // rare recovery path can afford to read the full canonical snapshot.
    const repos: unknown = JSON.parse(readFileSync(reposPath, 'utf8'))
    if (!Array.isArray(repos) || repos.length !== expectedCount) {
      throw new Error('Cannot recover search metadata from the canonical snapshot')
    }
    return repos as Partial<Repo>[]
  }
}
