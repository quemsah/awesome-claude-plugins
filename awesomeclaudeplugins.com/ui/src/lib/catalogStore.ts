/** biome-ignore-all lint/style/useNamingConvention: catalog data uses snake_case fields */

import { createHash } from 'node:crypto'
import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { Repo } from '../schemas/repo.schema.ts'
import { getSqliteReader } from './sqliteCatalogStore.ts'

const CATALOG_KEY = Symbol.for('awesome-claude-plugins.catalog')
const SHARD_CACHE_KEY = Symbol.for('awesome-claude-plugins.shard-cache')
const FALLBACK_REPOS_KEY = Symbol.for('awesome-claude-plugins.canonical-fallback')
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/

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
  canonicalSha256?: string
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
    index.search.length > 0 &&
    (index.canonicalSha256 === undefined || (typeof index.canonicalSha256 === 'string' && SHA256_HEX_PATTERN.test(index.canonicalSha256)))
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

/** Stream the canonical snapshot through SHA-256 instead of allocating another 42 MB buffer. */
function hashCanonicalFile(path: string): string {
  const hasher = createHash('sha256')
  const buffer = Buffer.allocUnsafe(64 * 1024)
  const fd = openSync(path, 'r')
  try {
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      hasher.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    closeSync(fd)
  }
  return hasher.digest('hex')
}

/** Recover invalid derived artifacts from the authoritative repos.json snapshot. */
export function readCatalogFiles(indexPath: string, reposPath: string): Repo[] {
  if (existsSync(indexPath)) {
    try {
      const index = JSON.parse(readFileSync(indexPath, 'utf8')) as SearchIndexV1
      const catalog = parseSearchIndex(index)
      // Both artifacts are generated together. Detect a stale index without
      // materializing the canonical JSON in memory during the normal path.
      if (index.canonicalSha256 && existsSync(reposPath) && hashCanonicalFile(reposPath) !== index.canonicalSha256) {
        throw new Error('Compact catalog does not match the canonical snapshot')
      }
      return catalog
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
  throw new Error('Missing compact catalog and canonical repository snapshot')
}

export function getCatalog(): readonly Repo[] {
  const root = globalThis as CatalogGlobal
  const cachedCatalog = root[CATALOG_KEY]
  if (cachedCatalog !== undefined) return cachedCatalog

  const fixturePath = process.env.CATALOG_DATA_PATH
  if (fixturePath && existsSync(fixturePath)) {
    const catalog = JSON.parse(readFileSync(fixturePath, 'utf8')) as Repo[]
    root[CATALOG_KEY] = catalog
    return catalog
  }

  // Legacy fallback: if legacy JSON fixtures are explicitly created, prioritize them for tests
  const searchIndexPath = join(process.cwd(), 'src/data/search-index.json')
  const reposPath = join(process.cwd(), 'src/data/repos.json')
  if (existsSync(searchIndexPath) || existsSync(reposPath)) {
    const catalog = readCatalogFiles(searchIndexPath, reposPath)
    root[CATALOG_KEY] = catalog
    return catalog
  }

  // Authoritative SQLite path is preferred whenever present
  const sqlitePath = process.env.CATALOG_SQLITE_PATH || join(process.cwd(), 'src/data/catalog.sqlite')
  if (existsSync(sqlitePath)) {
    const catalog = [...getSqliteReader().iteratePublishedRecords()] as Repo[]
    root[CATALOG_KEY] = catalog
    return catalog
  }

  throw new Error('Missing catalog data source')
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

function getRepoDetailsFromSqlite(id: number, owner?: string | null, repoName?: string | null): Partial<Repo> | null {
  const sqlitePath = process.env.CATALOG_SQLITE_PATH || join(process.cwd(), 'src/data/catalog.sqlite')
  if (!existsSync(sqlitePath)) return null
  const reader = getSqliteReader()
  const record = reader.getRecordById(id)
  return record && matchesIdentity(record, id, owner, repoName) ? (record as Repo) : null
}

function loadShard(shardId: number): Record<string, Partial<Repo>> | undefined {
  const cache = getShardCache()
  const cached = cache.get(shardId)
  if (cached !== undefined) {
    cache.delete(shardId)
    cache.set(shardId, cached)
    return cached
  }
  const shardPath = join(process.cwd(), `src/data/repo-details/${shardId}.json`)
  if (!existsSync(shardPath)) return undefined
  try {
    const shard = JSON.parse(readFileSync(shardPath, 'utf8')) as Record<string, Partial<Repo>>
    if (cache.size >= 10) {
      const oldestKey = cache.keys().next().value
      if (oldestKey !== undefined) cache.delete(oldestKey)
    }
    cache.set(shardId, shard)
    return shard
  } catch {
    return undefined
  }
}

function getFromCanonicalFallback(id: number, owner?: string | null, repoName?: string | null): Partial<Repo> | null {
  const canonical = getCanonicalFallback()
  if (!canonical) return null
  return canonical.get(id)?.find((record) => matchesIdentity(record, id, owner, repoName)) ?? null
}

/** Bounded LRU: touch a hit so frequently used detail buckets are not evicted. */
export function getRepoDetails(id: number, owner?: string | null, repoName?: string | null): Partial<Repo> | null {
  const shardsDir = join(process.cwd(), 'src/data/repo-details')
  const reposPath = join(process.cwd(), 'src/data/repos.json')
  const hasLegacyFiles = existsSync(shardsDir) || existsSync(reposPath)

  if (!hasLegacyFiles) {
    return getRepoDetailsFromSqlite(id, owner, repoName)
  }

  const shard = loadShard(Math.abs(id % 100))
  const details = shard?.[id]
  if (details && matchesIdentity(details, id, owner, repoName)) {
    return details
  }

  return getFromCanonicalFallback(id, owner, repoName)
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
    // getCatalog already validates V1 rows. Decode only the search metadata
    // here, without retaining the large rows object during decompression.
    const encoded = (JSON.parse(readFileSync(indexPath, 'utf8')) as SearchIndexV1).search
    if (typeof encoded !== 'string') throw new Error('Missing compressed search payload')
    const fields: unknown = JSON.parse(gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8'))
    if (!Array.isArray(fields) || fields.length !== expectedCount) {
      throw new Error('Misaligned search metadata')
    }
    return fields as Partial<Repo>[]
  } catch (error) {
    // Corrupt compressed metadata must not disable plugin-name search. This
    // rare recovery path can afford to read the full canonical snapshot.
    const repos: unknown = JSON.parse(readFileSync(reposPath, 'utf8'))
    if (!Array.isArray(repos) || repos.length !== expectedCount) {
      throw new Error('Cannot recover search metadata from the canonical snapshot', { cause: error })
    }
    return repos as Partial<Repo>[]
  }
}
