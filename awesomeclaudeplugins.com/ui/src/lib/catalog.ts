/** biome-ignore-all lint/style/useNamingConvention: catalog data uses snake_case fields */

import statsData from '../data/stats.json' with { type: 'json' }
import type { PluginSummary, Repo } from '../schemas/repo.schema.ts'
import { getLatestValidStatsDate } from './catalogDates.ts'
import { CATALOG_PAGE_SIZE } from './catalogPagination.ts'
import { type CatalogQuality, getCatalogQuality } from './catalogQuality.ts'
import { getCatalog } from './catalogStore.ts'
import { createFuseIndex } from './fuzzySearch.ts'
import { isArchivedRepo } from './repoMetadata.ts'
import { getGitHubRepoPath } from './repositoryIdentity.ts'
import { normalizeSearchQuery } from './searchQuery.ts'
import type { SortOption } from './sortOptions.ts'

export type CatalogRepo = Repo

const catalogRepos: readonly CatalogRepo[] = getCatalog().filter(
  (repo): repo is CatalogRepo => repo.owner != null && repo.repo_name != null
)
const canonicalCatalogRepos = getUniqueCatalogRepos(catalogRepos)
const canonicalCatalogRepoSet = new Set(canonicalCatalogRepos)
const indexableCatalogRepos = canonicalCatalogRepos.filter((repo) => getCatalogQuality(repo, true).publicationState === 'indexable')
const catalogReposByPath = new Map<string, CatalogRepo>()
for (const repo of catalogRepos) {
  const path = `${repo.owner}/${repo.repo_name}`.toLowerCase()
  if (!catalogReposByPath.has(path)) {
    catalogReposByPath.set(path, repo)
  }
}

function sortDateValue(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Keep archived repositories at the end of every search/browse ordering. */
export function compareCatalogRepos(left: CatalogRepo, right: CatalogRepo, sortOption: SortOption): number {
  const archivedDiff = Number(isArchivedRepo(left)) - Number(isArchivedRepo(right))
  if (archivedDiff !== 0) return archivedDiff
  const descriptionSignal = (repo: CatalogRepo) => (repo.description?.trim() ? 1 : 0)
  switch (sortOption) {
    case 'forks-desc':
      return (right.forks_count ?? 0) - (left.forks_count ?? 0)
    case 'plugins-desc': {
      const pluginSignal = (repo: CatalogRepo) => (repo.plugins_count ?? 0) * Math.log10((repo.stargazers_count ?? 0) + 10)
      return pluginSignal(right) - pluginSignal(left) || (right.plugins_count ?? 0) - (left.plugins_count ?? 0)
    }
    case 'updated-desc':
      return sortDateValue(right.pushed_at) - sortDateValue(left.pushed_at) || (right.stargazers_count ?? 0) - (left.stargazers_count ?? 0)
    case 'created-desc':
      return (
        sortDateValue(right.catalog_added_at) - sortDateValue(left.catalog_added_at) || (right.stargazers_count ?? 0) - (left.stargazers_count ?? 0)
      )
    default:
      return (right.stargazers_count ?? 0) - (left.stargazers_count ?? 0) || descriptionSignal(right) - descriptionSignal(left)
  }
}

const catalogReposBySort: Record<SortOption, readonly CatalogRepo[]> = {
  'stars-desc': [...canonicalCatalogRepos].sort((left, right) => compareCatalogRepos(left, right, 'stars-desc')),
  'forks-desc': [...canonicalCatalogRepos].sort((left, right) => compareCatalogRepos(left, right, 'forks-desc')),
  'plugins-desc': [...canonicalCatalogRepos].sort((left, right) => compareCatalogRepos(left, right, 'plugins-desc')),
  'updated-desc': [...canonicalCatalogRepos].sort((left, right) => compareCatalogRepos(left, right, 'updated-desc')),
  'created-desc': [...canonicalCatalogRepos].sort((left, right) => compareCatalogRepos(left, right, 'created-desc')),
}
const catalogPluginsCount = canonicalCatalogRepos.reduce((total, repo) => total + (repo.plugins_count ?? 0), 0)

export type CatalogSearchResult = {
  hasMore: boolean
  pluginsCount: number
  repos: CatalogRepo[]
  total: number
}

export function getCatalogRepos(): readonly CatalogRepo[] {
  return catalogRepos
}

/**
 * Repositories whose canonical `/{owner}/{repo}` path is unique, case-insensitively.
 *
 * The catalog contains case-only duplicates and `findCatalogRepo` resolves them to the first
 * match, so the other spellings permanently redirect. Consumers that publish canonical URLs
 * (the sitemap, IndexNow) must therefore skip them.
 */
export function getCanonicalCatalogRepos(): readonly CatalogRepo[] {
  return canonicalCatalogRepos
}

export function getIndexableCatalogRepos(): readonly CatalogRepo[] {
  return indexableCatalogRepos
}

/** Pages the browse route serves: it paginates the whole canonical catalog, which is larger than the indexable subset. */
export function getBrowsePageCount(): number {
  return Math.ceil(canonicalCatalogRepos.length / CATALOG_PAGE_SIZE)
}

export function getCatalogQualityForRepo(repo: CatalogRepo, fallbackDescription?: string | null): CatalogQuality {
  return getCatalogQuality(repo, canonicalCatalogRepoSet.has(repo), fallbackDescription)
}

function getUniqueCatalogRepos(repos: readonly CatalogRepo[]): readonly CatalogRepo[] {
  const seen = new Set<string>()
  return repos.filter((repo) => {
    const key = `${repo.owner}/${repo.repo_name}`.toLowerCase()
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

type ScoredCatalogRepo = { repo: CatalogRepo; score: number }
type SearchCacheEntry = { expiresAt: number; records: ScoredCatalogRepo[]; sorted?: Map<SortOption, ScoredCatalogRepo[]> }

// Same freshness window the catalog api already publishes to clients.
const SEARCH_CACHE_TTL_MS = 60_000
const SEARCH_CACHE_MAX_ENTRIES = 64
// A broad term matches ~20k of the 40k records, so entries are bounded by total records too: without
// it, 64 popular terms would hold a copy of the whole catalog several times over. Measured at the
// cap: 250k wrappers add ~20MB of heap.
const SEARCH_CACHE_MAX_RECORDS = 250_000
const SEARCH_CACHE_GLOBAL_KEY = 'catalogSearchMatchesCache'

/**
 * The home route and the catalog route handler are separate bundles, each with its own module
 * registry, so a module-level map would keep two private copies of the same scan.
 */
function getSearchCache(): Map<string, SearchCacheEntry> {
  const holder = globalThis as unknown as Record<string, Map<string, SearchCacheEntry> | undefined>
  let cache = holder[SEARCH_CACHE_GLOBAL_KEY]
  if (!cache) {
    cache = new Map()
    holder[SEARCH_CACHE_GLOBAL_KEY] = cache
  }
  return cache
}

function countCachedRecords(cache: Map<string, SearchCacheEntry>): number {
  return [...cache.values()].reduce(
    (total, entry) =>
      total + entry.records.length + [...(entry.sorted?.values() ?? [])].reduce((count, records) => count + records.length, 0),
    0
  )
}

/**
 * The fuzzy scan is the only expensive step of a catalog request, and one search interaction runs it
 * twice within a second: once to server-render `/?q=…` and once for the `/api/catalog` call the
 * client fires for the same term. Keyed by the shared normalized query so sort and page variants,
 * and both entry points, reuse one scan.
 */
function getScoredMatches(normalizedQuery: string, repos: readonly CatalogRepo[]): ScoredCatalogRepo[] {
  const cache = getSearchCache()
  const cached = cache.get(normalizedQuery)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.records
  }

  const records = normalizedQuery
    ? createFuseIndex(repos)
        .search(normalizedQuery)
        .map((result) => ({ repo: result.item, score: result.score ?? Number.POSITIVE_INFINITY }))
    : repos.map((repo) => ({ repo, score: 0 }))

  cache.set(normalizedQuery, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, records })
  let cachedRecords = countCachedRecords(cache)
  while (cache.size > SEARCH_CACHE_MAX_ENTRIES || cachedRecords > SEARCH_CACHE_MAX_RECORDS) {
    const oldest = cache.keys().next()
    if (oldest.done) {
      break
    }
    cache.delete(oldest.value)
    cachedRecords = countCachedRecords(cache)
  }
  return records
}

export function searchCatalogRepos(query: string, sortOption: SortOption, page = 0, pageSize = CATALOG_PAGE_SIZE): CatalogSearchResult {
  const normalizedQuery = normalizeSearchQuery(query)
  const matchingRepos = normalizedQuery ? getScoredMatches(normalizedQuery, canonicalCatalogRepos) : undefined
  let repos: CatalogRepo[]
  if (!matchingRepos) {
    repos = catalogReposBySort[sortOption].slice(page * pageSize, (page + 1) * pageSize)
  } else {
    const cacheEntry = getSearchCache().get(normalizedQuery)
    const sortedMatches = cacheEntry?.sorted ?? new Map<SortOption, ScoredCatalogRepo[]>()
    if (cacheEntry && !cacheEntry.sorted) {
      cacheEntry.sorted = sortedMatches
    }
    let sorted = sortedMatches.get(sortOption)
    if (!sorted) {
      sorted = [...matchingRepos].sort((left, right) => compareCatalogRepos(left.repo, right.repo, sortOption) || left.score - right.score)
      sortedMatches.set(sortOption, sorted)
      const cache = getSearchCache()
      let cachedRecords = countCachedRecords(cache)
      while (cache.size > SEARCH_CACHE_MAX_ENTRIES || cachedRecords > SEARCH_CACHE_MAX_RECORDS) {
        const oldest = cache.keys().next()
        if (oldest.done) break
        cache.delete(oldest.value)
        cachedRecords = countCachedRecords(cache)
      }
    }
    repos = sorted.slice(page * pageSize, (page + 1) * pageSize).map((result) => result.repo)
  }
  const start = page * pageSize
  const total = matchingRepos?.length ?? canonicalCatalogRepos.length
  const pluginsCount = matchingRepos?.reduce((sum, result) => sum + (result.repo.plugins_count ?? 0), 0) ?? catalogPluginsCount

  return {
    hasMore: start + pageSize < total,
    pluginsCount,
    repos: repos.map((repo) => formatCatalogRepo(repo)),
    total,
  }
}

export function extractPluginSummaries(repo: CatalogRepo): PluginSummary[] | undefined {
  if (Array.isArray(repo.plugins) && repo.plugins.length > 0) {
    const list = repo.plugins
      .filter((p): p is PluginSummary => typeof p === 'object' && p !== null)
      .map((p) => {
        const item: PluginSummary = {}
        if (typeof p.name === 'string' && p.name.trim()) item.name = p.name.trim()
        if (typeof p.description === 'string' && p.description.trim()) item.description = p.description.trim()
        return item
      })
      .filter((p) => Boolean(p.name || p.description))

    if (list.length > 0) return list
  }

  const raw = repo as Record<string, unknown>
  if (Array.isArray(raw.plugin_summaries) && raw.plugin_summaries.length > 0) {
    const list = raw.plugin_summaries
      .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
      .map((p) => {
        const item: PluginSummary = {}
        if (typeof p.name === 'string' && p.name.trim()) item.name = p.name.trim()
        if (typeof p.description === 'string' && p.description.trim()) item.description = p.description.trim()
        return item
      })
      .filter((p) => Boolean(p.name || p.description))

    if (list.length > 0) return list
  }

  if (typeof raw.plugin_name === 'string' || typeof raw.plugin_description === 'string') {
    const item: PluginSummary = {}
    if (typeof raw.plugin_name === 'string' && raw.plugin_name.trim()) item.name = raw.plugin_name.trim()
    if (typeof raw.plugin_description === 'string' && raw.plugin_description.trim()) item.description = raw.plugin_description.trim()
    if (item.name || item.description) return [item]
  }

  return undefined
}

export function formatCatalogRepo(repo: CatalogRepo): CatalogRepo {
  const plugins = extractPluginSummaries(repo)
  if (plugins && plugins.length > 0) {
    return {
      ...repo,
      plugins,
    }
  }
  return repo
}

export function findCatalogRepo(repoPath: string) {
  return catalogReposByPath.get(repoPath.toLowerCase())
}

export function getCatalogLastModified() {
  return getLatestValidStatsDate(statsData)
}

export function getRepoCanonicalPath(repo: CatalogRepo) {
  if (!(repo.owner && repo.repo_name)) {
    return ''
  }
  return getGitHubRepoPath(repo.owner, repo.repo_name)
}
