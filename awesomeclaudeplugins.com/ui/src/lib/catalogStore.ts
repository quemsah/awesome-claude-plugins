/** biome-ignore-all lint/style/useNamingConvention: catalog data uses snake_case fields */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { Repo } from '../schemas/repo.schema.ts'

const CATALOG_KEY = Symbol.for('awesome-claude-plugins.catalog')
const SHARD_CACHE_KEY = Symbol.for('awesome-claude-plugins.shard-cache')

type ShardCache = Map<number, Record<string, Partial<Repo>>>
type CatalogGlobal = typeof globalThis & {
  [CATALOG_KEY]?: readonly Repo[]
  [SHARD_CACHE_KEY]?: ShardCache
}

export type SearchIndexV1 = {
  format: 'v1'
  fields: string[]
  rows: unknown[][]
  search: string
}

export function parseSearchIndex(content: string | SearchIndexV1): Repo[] {
  const parsed = typeof content === 'string' ? JSON.parse(content) : content
  if (Array.isArray(parsed)) {
    return parsed as Repo[]
  }
  if (parsed && parsed.format === 'v1' && Array.isArray(parsed.rows)) {
    const v1 = parsed as SearchIndexV1
    return v1.rows.map((row, searchRow) => {
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
  return []
}

export function getCatalog(): readonly Repo[] {
  const root = globalThis as CatalogGlobal
  const cachedCatalog = root[CATALOG_KEY]
  if (cachedCatalog !== undefined) return cachedCatalog

  const indexPath = join(process.cwd(), 'src/data/search-index.json')
  const reposPath = join(process.cwd(), 'src/data/repos.json')

  let catalog: Repo[]
  if (existsSync(indexPath)) {
    const fileContents = readFileSync(indexPath, 'utf8')
    const parsed = JSON.parse(fileContents) as SearchIndexV1
    // A checked-in legacy index may predate the compact card fields. Never serve
    // fabricated descriptions or marketplace commands from that older format.
    if (parsed.format === 'v1' && parsed.fields?.includes('description') && parsed.fields?.includes('manifest_kind')) {
      catalog = parseSearchIndex(parsed)
    } else if (existsSync(reposPath)) {
      catalog = JSON.parse(readFileSync(reposPath, 'utf8')) as Repo[]
    } else {
      throw new Error('Incompatible compact catalog and no canonical repository snapshot')
    }
  } else if (existsSync(reposPath)) {
    const fileContents = readFileSync(reposPath, 'utf8')
    catalog = JSON.parse(fileContents) as Repo[]
  } else {
    catalog = []
  }

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

  // Rare recovery path: read the actual canonical snapshot, not the compact global index.
  const path = join(process.cwd(), 'src/data/repos.json')
  if (!existsSync(path)) return null
  try {
    const repos = JSON.parse(readFileSync(path, 'utf8')) as Repo[]
    return repos.find((record) => matchesIdentity(record, id, owner, repoName)) ?? null
  } catch {
    return null
  }
}

export function hydrateCatalogRepo<T extends Repo>(repo: T): T {
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

/** Transient search fields: never retained by the catalog or the result cache. */
export function readCatalogSearchFields(): Partial<Repo>[] {
  const index = JSON.parse(readFileSync(join(process.cwd(), 'src/data/search-index.json'), 'utf8')) as SearchIndexV1
  return JSON.parse(gunzipSync(Buffer.from(index.search, 'base64')).toString('utf8')) as Partial<Repo>[]
}
