/** biome-ignore-all lint/style/useNamingConvention: catalog data uses snake_case fields */

import type { PluginSummary, Repo } from '../schemas/repo.schema.ts'
import type { StatsItem } from '../schemas/stats.schema.ts'
import { CATALOG_PAGE_SIZE } from './catalogPagination.ts'
import type { CatalogQuality } from './catalogQuality.ts'
import type { CatalogSummary } from './llmsText.ts'
import { isArchivedRepo } from './repoMetadata.ts'
import { getGitHubRepoPath } from './repositoryIdentity.ts'
import type { SortOption } from './sortOptions.ts'
import {
  getSqliteReader,
  sqliteFindCatalogRepo,
  sqliteGetBrowsePageCount,
  sqliteGetCatalogCanonicalCount,
  sqliteGetCatalogLastModified,
  sqliteGetCatalogQualityForRepo,
  sqliteGetCatalogSummary,
  sqliteGetStatsHistory,
  sqliteSearchCatalogRepos,
} from './sqliteCatalogStore.ts'

export type CatalogRepo = Repo

export type CatalogBackend = 'sqlite'

export function getCatalogBackend(): CatalogBackend {
  return 'sqlite'
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

export type CatalogSearchResult = {
  hasMore: boolean
  pluginsCount: number
  repos: CatalogRepo[]
  total: number
}

/** Return published records from SQLite snapshot. */
export function getCatalogRepos(): readonly CatalogRepo[] {
  return [...getSqliteReader().iteratePublishedRecords()]
}

/** Return all canonical repositories. */
export function getCanonicalCatalogRepos(): readonly CatalogRepo[] {
  const seen = new Set<string>()
  const list: CatalogRepo[] = []
  for (const record of getSqliteReader().iteratePublishedRecords()) {
    const key = `${record.owner}/${record.repo_name}`.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    list.push(record)
  }
  return list
}

/** Return indexable repositories. */
export function getIndexableCatalogRepos(): readonly CatalogRepo[] {
  const list: CatalogRepo[] = []
  for (const row of getSqliteReader().iterateIndexableRepos()) {
    const repo = findCatalogRepo(row.path)
    if (repo) list.push(repo)
  }
  return list
}

/** Total canonical repository count. */
export function getCatalogCanonicalCount(): number {
  return sqliteGetCatalogCanonicalCount()
}

/** Pages the browse route serves: it paginates the whole canonical catalog. */
export function getBrowsePageCount(): number {
  return sqliteGetBrowsePageCount()
}

export function getCatalogQualityForRepo(repo: CatalogRepo, fallbackDescription?: string | null): CatalogQuality {
  return sqliteGetCatalogQualityForRepo(repo, fallbackDescription)
}

export type CatalogSearchOptions = { summaries?: 'full' | 'omit' }

/** Search or browse repositories via SQLite backend. */
export function searchCatalogRepos(
  query: string,
  sortOption: SortOption,
  page = 0,
  pageSize = CATALOG_PAGE_SIZE,
  options: CatalogSearchOptions = {}
): CatalogSearchResult {
  return sqliteSearchCatalogRepos(query, sortOption, page, pageSize, options)
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

export function findCatalogRepo(repoPath: string): CatalogRepo | undefined {
  return sqliteFindCatalogRepo(repoPath)
}

export function getCatalogLastModified(): Date {
  return sqliteGetCatalogLastModified()
}

export function getRepoCanonicalPath(repo: { owner?: string | null; repo_name?: string | null }): string {
  if (!(repo.owner && repo.repo_name)) {
    return ''
  }
  return getGitHubRepoPath(repo.owner, repo.repo_name)
}

export function getPublishedCatalogSummary(): CatalogSummary {
  return sqliteGetCatalogSummary()
}

export function getStatsHistory(): StatsItem[] {
  return sqliteGetStatsHistory()
}
