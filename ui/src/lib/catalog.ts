/** biome-ignore-all lint/style/useNamingConvention: catalog data uses snake_case fields */

import reposData from '../data/repos.json' with { type: 'json' }
import statsData from '../data/stats.json' with { type: 'json' }
import { type Repo, ReposArraySchema } from '../schemas/repo.schema.ts'
import { StatsItemSchema } from '../schemas/stats.schema.ts'
import { CATALOG_PAGE_SIZE } from './catalogPagination.ts'
import { createFuseIndex } from './fuzzySearch.ts'
import { getGitHubRepoPath } from './repositoryIdentity.ts'
import type { SortOption } from './sortOptions.ts'

const FALLBACK_LAST_MODIFIED = new Date('2026-01-01T00:00:00.000Z')

export type CatalogRepo = Repo

const catalogResult = ReposArraySchema.safeParse(reposData)

if (!catalogResult.success) {
  throw new Error(`Invalid catalog data: ${catalogResult.error.issues.map((issue) => issue.message).join(', ')}`)
}

const catalogRepos: readonly CatalogRepo[] = catalogResult.data

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
  const seen = new Set<string>()
  return catalogRepos.filter((repo) => {
    const key = `${repo.owner}/${repo.repo_name}`.toLowerCase()
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

export function searchCatalogRepos(query: string, sortOption: SortOption, page = 0, pageSize = CATALOG_PAGE_SIZE): CatalogSearchResult {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matchingRepos = normalizedQuery
    ? createFuseIndex(catalogRepos)
        .search(normalizedQuery)
        .map((result) => ({ repo: result.item, score: result.score ?? Number.POSITIVE_INFINITY }))
    : catalogRepos.map((repo) => ({ repo, score: 0 }))
  const sortedRepos = [...matchingRepos].sort((left, right) => {
    if (normalizedQuery && left.score !== right.score) {
      return left.score - right.score
    }

    const leftRepo = left.repo
    const rightRepo = right.repo
    const descriptionSignal = (repo: CatalogRepo) => (repo.description?.trim() ? 1 : 0)
    switch (sortOption) {
      case 'forks-desc':
        return (rightRepo.forks_count ?? 0) - (leftRepo.forks_count ?? 0)
      case 'plugins-desc': {
        const pluginSignal = (repo: CatalogRepo) => {
          const pluginCount = repo.plugins_count ?? 0
          const stars = repo.stargazers_count ?? 0
          return pluginCount * Math.log10(stars + 10)
        }
        return pluginSignal(rightRepo) - pluginSignal(leftRepo) || (rightRepo.plugins_count ?? 0) - (leftRepo.plugins_count ?? 0)
      }
      default:
        return (
          descriptionSignal(rightRepo) - descriptionSignal(leftRepo) || (rightRepo.stargazers_count ?? 0) - (leftRepo.stargazers_count ?? 0)
        )
    }
  })
  const start = page * pageSize

  return {
    hasMore: start + pageSize < matchingRepos.length,
    pluginsCount: matchingRepos.reduce((total, result) => total + (result.repo.plugins_count ?? 0), 0),
    repos: sortedRepos.slice(start, start + pageSize).map((result) => result.repo),
    total: matchingRepos.length,
  }
}

export function findCatalogRepo(repoPath: string) {
  const normalizedPath = repoPath.toLowerCase()
  return getCatalogRepos().find((repo) => `${repo.owner}/${repo.repo_name}`.toLowerCase() === normalizedPath)
}

export function getCatalogLastModified() {
  if (!Array.isArray(statsData) || statsData.length === 0) {
    return FALLBACK_LAST_MODIFIED
  }

  const lastEntryRaw = statsData[statsData.length - 1]
  const validationResult = StatsItemSchema.safeParse(lastEntryRaw)

  if (!validationResult.success) {
    return FALLBACK_LAST_MODIFIED
  }

  const parsedDate = new Date(validationResult.data.date)

  if (Number.isNaN(parsedDate.getTime())) {
    return FALLBACK_LAST_MODIFIED
  }

  return parsedDate
}

export function getRepoCanonicalPath(repo: CatalogRepo) {
  return getGitHubRepoPath(repo.owner, repo.repo_name)
}

export function getRepoSitemapPriority(repo: CatalogRepo) {
  return repo.plugins_count === null ? 0.3 : 0.5
}
