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

function parseSearchIndex(content: string): Repo[] {
  const parsed = JSON.parse(content)
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
      const descriptionQuality = row[10] as number
      const description =
        descriptionQuality === 2
          ? 'Description available in repository details.'
          : descriptionQuality === 1
            ? 'Description available.'
            : null

      return {
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
        searchRow,
        description,
        catalog_updated_at: (row[11] as string | null) ?? undefined,
        subscribers_count: null,
      } as Repo
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
    catalog = parseSearchIndex(fileContents)
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

export function getRepoDetails(id: number, _owner?: string | null, _repoName?: string | null): Partial<Repo> | null {
  // Check sharded files: repo-details/${shard}.json
  const shardId = Math.abs(id % 100)
  const shardCache = getShardCache()
  let shard = shardCache.get(shardId)

  if (shard === undefined) {
    const shardPath = join(process.cwd(), `src/data/repo-details/${shardId}.json`)
    if (existsSync(shardPath)) {
      try {
        shard = JSON.parse(readFileSync(shardPath, 'utf8')) as Record<string, Partial<Repo>>
        if (shardCache.size >= 10) {
          const firstKey = shardCache.keys().next().value
          if (firstKey !== undefined) shardCache.delete(firstKey)
        }
        shardCache.set(shardId, shard)
      } catch {
        shard = undefined
      }
    }
  }

  if (shard?.[id]) {
    const details = shard[id]
    return details
  }

  // Check individual file: repo-details/${id}.json
  const idPath = join(process.cwd(), `src/data/repo-details/${id}.json`)
  if (existsSync(idPath)) {
    try {
      const details = JSON.parse(readFileSync(idPath, 'utf8')) as Partial<Repo>
      return details
    } catch {
      // ignore
    }
  }

  // Fallback to repos.json if repo-details not found
  const reposPath = join(process.cwd(), 'src/data/repos.json')
  if (existsSync(reposPath)) {
    const root = globalThis as CatalogGlobal
    const repos = root[CATALOG_KEY]
    if (repos) {
      const found = repos.find((r) => r.id === id)
      if (found) {
        return found
      }
    }
  }

  return null
}

export function hydrateCatalogRepo<T extends Repo>(repo: T): T {
  const details = getRepoDetails(repo.id, repo.owner, repo.repo_name)
  return details ? (details as T) : repo
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
