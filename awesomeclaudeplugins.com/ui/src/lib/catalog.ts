/** biome-ignore-all lint/style/useNamingConvention: catalog data uses snake_case fields */

import statsData from '../data/stats.json' with { type: 'json' }
import type { PluginSummary, Repo } from '../schemas/repo.schema.ts'
import { getLatestValidStatsDate } from './catalogDates.ts'
import { CATALOG_PAGE_SIZE } from './catalogPagination.ts'
import { type CatalogQuality, getCatalogQuality } from './catalogQuality.ts'
import { getCatalog } from './catalogStore.ts'
import { createCatalogSearchIndex, hasSearchableTerms } from './fuzzySearch.ts'
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
// Different Next.js route bundles can have different module registries in the same process.
// Key the shared index by the original catalog array, which catalogStore already shares globally.
const CATALOG_SEARCH_INDEX_KEY = Symbol.for('awesome-claude-plugins.catalog-search-index')
type SharedSearchIndex = { source: readonly CatalogRepo[]; index: ReturnType<typeof createCatalogSearchIndex> }
type CatalogSearchGlobal = typeof globalThis & { [CATALOG_SEARCH_INDEX_KEY]?: SharedSearchIndex }

/** Lazily create one FTS5 index per catalog and Node.js process, shared by SSR and API routes. */
function getCatalogSearchIndex() {
  const root = globalThis as CatalogSearchGlobal
  const source = getCatalog()
  const cached = root[CATALOG_SEARCH_INDEX_KEY]
  if (cached?.source === source) return cached.index

  const index = createCatalogSearchIndex(canonicalCatalogRepos)
  root[CATALOG_SEARCH_INDEX_KEY] = { source, index }
  return index
}

/** Non-searchable input is a zero-hit search, not a request to browse the full catalog. */
function searchIndexedCatalogQuery(query: string, sortOption: SortOption, page: number, pageSize: number) {
  if (!hasSearchableTerms(query)) {
    return { matches: [], total: 0, pluginsCount: 0 }
  }
  return getCatalogSearchIndex().search(query, sortOption, page, pageSize)
}

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

function stars(repo: CatalogRepo): number {
  return repo.stargazers_count ?? 0
}

function compareStars(left: CatalogRepo, right: CatalogRepo): number {
  const descriptionSignal = (repo: CatalogRepo) => (repo.description?.trim() ? 1 : 0)
  return stars(right) - stars(left) || descriptionSignal(right) - descriptionSignal(left)
}

function comparePlugins(left: CatalogRepo, right: CatalogRepo): number {
  const pluginSignal = (repo: CatalogRepo) => (repo.plugins_count ?? 0) * Math.log10(stars(repo) + 10)
  return pluginSignal(right) - pluginSignal(left) || (right.plugins_count ?? 0) - (left.plugins_count ?? 0)
}

function compareDates(left: CatalogRepo, right: CatalogRepo, field: 'pushed_at' | 'catalog_added_at'): number {
  return sortDateValue(right[field]) - sortDateValue(left[field]) || stars(right) - stars(left)
}

/** Keep archived repositories at the end of every search/browse ordering. */
export function compareCatalogRepos(left: CatalogRepo, right: CatalogRepo, sortOption: SortOption): number {
  const archivedDiff = Number(isArchivedRepo(left)) - Number(isArchivedRepo(right))
  if (archivedDiff !== 0) return archivedDiff
  switch (sortOption) {
    case 'forks-desc':
      return (right.forks_count ?? 0) - (left.forks_count ?? 0)
    case 'plugins-desc':
      return comparePlugins(left, right)
    case 'updated-desc':
      return compareDates(left, right, 'pushed_at')
    case 'created-desc':
      return compareDates(left, right, 'catalog_added_at')
    default:
      return compareStars(left, right)
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

type CatalogSearchOptions = { summaries?: 'full' | 'omit' }

/** Keep public API summaries by default; the card UI opts into lightweight results. */
export function searchCatalogRepos(
  query: string,
  sortOption: SortOption,
  page = 0,
  pageSize = CATALOG_PAGE_SIZE,
  options: CatalogSearchOptions = {}
): CatalogSearchResult {
  const normalizedQuery = normalizeSearchQuery(query)
  const matches = normalizedQuery ? searchIndexedCatalogQuery(normalizedQuery, sortOption, page, pageSize) : undefined
  const repos = matches
    ? matches.matches.map((match) => match.item)
    : catalogReposBySort[sortOption].slice(page * pageSize, (page + 1) * pageSize)
  const start = page * pageSize
  const total = matches?.total ?? canonicalCatalogRepos.length
  const pluginsCount = matches?.pluginsCount ?? catalogPluginsCount

  return {
    hasMore: start + pageSize < total,
    pluginsCount,
    repos: repos.map((repo) => (options.summaries === 'omit' ? withoutPluginSummaries(repo) : formatCatalogRepo(repo))),
    total,
  }
}

function withoutPluginSummaries(repo: CatalogRepo): CatalogRepo {
  const card: CatalogRepo = { ...repo }
  delete card.plugins
  delete card.plugin_summaries
  delete card.plugin_name
  delete card.plugin_description
  return card
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
