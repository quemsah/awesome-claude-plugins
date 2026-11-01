/** biome-ignore-all lint/style/useNamingConvention: catalog data uses snake_case fields */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Repo } from '../schemas/repo.schema.ts'

const CATALOG_KEY = Symbol.for('awesome-claude-plugins.catalog')
const SHARD_CACHE_KEY = Symbol.for('awesome-claude-plugins.shard-cache')
const DETAILS_CACHE_KEY = Symbol.for('awesome-claude-plugins.details-cache')

type ShardCache = Map<number, Record<string, Partial<Repo>>>
type DetailsCache = Map<number, Partial<Repo>>

type CatalogGlobal = typeof globalThis & {
  [CATALOG_KEY]?: readonly Repo[]
  [SHARD_CACHE_KEY]?: ShardCache
  [DETAILS_CACHE_KEY]?: DetailsCache
}

export type SearchIndexV1 = {
  format: 'v1'
  fields: string[]
  rows: (string | number | boolean | null | string[])[][]
}

function parseSearchIndex(content: string): Repo[] {
  const parsed = JSON.parse(content)
  if (Array.isArray(parsed)) {
    return parsed as Repo[]
  }
  if (parsed && parsed.format === 'v1' && Array.isArray(parsed.rows)) {
    const v1 = parsed as SearchIndexV1
    return v1.rows.map((row) => {
      const id = row[0] as number
      const owner = row[1] as string
      const repo_name = row[2] as string
      const stargazers_count = (row[3] as number) ?? 0
      const forks_count = (row[4] as number) ?? 0
      const plugins_count = (row[5] as number | null) ?? null
      const pushed_at = (row[6] as string | null) ?? null
      const license = (row[7] as string | null) ?? null
      const archived = Boolean(row[8])
      const catalog_added_at = (row[9] as string | null) ?? null
      const tokens = Array.isArray(row[10]) ? (row[10] as string[]) : null
      const has_desc = Boolean(row[11])

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
        plugin_name: tokens && tokens.length > 0 ? tokens.join(', ') : undefined,
        description: has_desc ? 'has_description' : null,
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

function getDetailsCache(): DetailsCache {
  const root = globalThis as CatalogGlobal
  if (!root[DETAILS_CACHE_KEY]) {
    root[DETAILS_CACHE_KEY] = new Map()
  }
  return root[DETAILS_CACHE_KEY]
}

export function getRepoDetails(id: number, _owner?: string | null, _repoName?: string | null): Partial<Repo> | null {
  const detailsCache = getDetailsCache()
  const cached = detailsCache.get(id)
  if (cached !== undefined) return cached

  // Check sharded files: repo-details/${shard}.json
  const shardId = Math.abs(id % 100)
  const shardCache = getShardCache()
  let shard = shardCache.get(shardId)

  if (shard === undefined) {
    const shardPath = join(process.cwd(), `src/data/repo-details/${shardId}.json`)
    if (existsSync(shardPath)) {
      try {
        shard = JSON.parse(readFileSync(shardPath, 'utf8')) as Record<string, Partial<Repo>>
        if (shardCache.size > 50) {
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
    detailsCache.set(id, details)
    return details
  }

  // Check individual file: repo-details/${id}.json
  const idPath = join(process.cwd(), `src/data/repo-details/${id}.json`)
  if (existsSync(idPath)) {
    try {
      const details = JSON.parse(readFileSync(idPath, 'utf8')) as Partial<Repo>
      detailsCache.set(id, details)
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
      if (found && (found.plugins !== undefined || (found.description !== null && found.description !== 'has_description'))) {
        detailsCache.set(id, found)
        return found
      }
    }
  }

  return null
}

export function hydrateCatalogRepo<T extends Repo>(repo: T): T {
  if (repo.plugins && repo.plugins.length > 0 && repo.description !== 'has_description') {
    return repo
  }

  const details = getRepoDetails(repo.id, repo.owner, repo.repo_name)
  if (!details) {
    return {
      ...repo,
      description: repo.description === 'has_description' ? null : repo.description,
    }
  }

  return {
    ...repo,
    description: details.description ?? (repo.description === 'has_description' ? null : repo.description),
    plugins: details.plugins ?? repo.plugins,
    subscribers_count: details.subscribers_count ?? repo.subscribers_count,
    catalog_updated_at: details.catalog_updated_at ?? repo.catalog_updated_at,
    ...(details.pushed_at ? { pushed_at: details.pushed_at } : {}),
    ...(details.catalog_added_at ? { catalog_added_at: details.catalog_added_at } : {}),
    ...(details.license ? { license: details.license } : {}),
  }
}
