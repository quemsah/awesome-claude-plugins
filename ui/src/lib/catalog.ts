/** biome-ignore-all lint/style/useNamingConvention: catalog data uses snake_case fields */

import reposData from '../data/repos.json' with { type: 'json' }
import statsData from '../data/stats.json' with { type: 'json' }
import { type Repo, ReposArraySchema } from '../schemas/repo.schema.ts'
import { getLatestValidStatsDate } from './catalogDates.ts'
import { CATALOG_PAGE_SIZE } from './catalogPagination.ts'
import { type CatalogQuality, getCatalogQuality } from './catalogQuality.ts'
import { createFuseIndex } from './fuzzySearch.ts'
import { getGitHubRepoPath } from './repositoryIdentity.ts'
import type { SortOption } from './sortOptions.ts'

export type CatalogRepo = Repo

const catalogResult = ReposArraySchema.safeParse(reposData)

if (!catalogResult.success) {
  throw new Error(`Invalid catalog data: ${catalogResult.error.issues.map((issue) => issue.message).join(', ')}`)
}

const catalogRepos: readonly CatalogRepo[] = catalogResult.data.filter(
  (repo): repo is CatalogRepo => repo.owner != null && repo.repo_name != null
)
const canonicalCatalogRepos = getUniqueCatalogRepos(catalogRepos)

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
  return canonicalCatalogRepos.filter((repo) => getCatalogQuality(repo, true).publicationState === 'indexable')
}

export function getCatalogQualityForRepo(repo: CatalogRepo): CatalogQuality {
  return getCatalogQuality(repo, canonicalCatalogRepos.includes(repo))
}

export function getRelatedCatalogRepos(repo: CatalogRepo, limit = 3): readonly CatalogRepo[] {
  const sourceTerms = getSearchTerms(repo)
  if (sourceTerms.size === 0) {
    return []
  }

  return getIndexableCatalogRepos()
    .filter((candidate) => candidate !== repo)
    .map((candidate) => {
      const candidateTerms = getSearchTerms(candidate)
      const overlap = [...sourceTerms].filter((term) => candidateTerms.has(term)).length
      return { candidate, overlap }
    })
    .filter(({ overlap }) => overlap > 0)
    .sort(
      (left, right) =>
        right.overlap - left.overlap ||
        (right.candidate.stargazers_count ?? 0) - (left.candidate.stargazers_count ?? 0) ||
        left.candidate.id - right.candidate.id
    )
    .slice(0, limit)
    .map(({ candidate }) => candidate)
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

function getSearchTerms(repo: CatalogRepo): Set<string> {
  const searchableText = [
    repo.description ?? '',
    ...(repo.plugin_categories ?? []),
    ...(repo.plugin_keywords ?? []),
    ...(repo.plugin_names ?? []),
  ]
    .join(' ')
    .toLocaleLowerCase()
  const terms = searchableText.match(/[a-z0-9][a-z0-9-]{3,}/g) ?? []
  return new Set(terms.filter((term) => !GENERIC_RELATED_TERMS.has(term)))
}

const GENERIC_RELATED_TERMS = new Set(['claude', 'code', 'plugin', 'plugins', 'repository', 'tool', 'tools'])

export function searchCatalogRepos(query: string, sortOption: SortOption, page = 0, pageSize = CATALOG_PAGE_SIZE): CatalogSearchResult {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const searchableCatalogRepos = getCanonicalCatalogRepos()
  const matchingRepos = normalizedQuery
    ? createFuseIndex(searchableCatalogRepos)
        .search(normalizedQuery)
        .map((result) => ({ repo: result.item, score: result.score ?? Number.POSITIVE_INFINITY }))
    : searchableCatalogRepos.map((repo) => ({ repo, score: 0 }))
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
  return getLatestValidStatsDate(statsData)
}

export function getRepoCanonicalPath(repo: CatalogRepo) {
  if (!(repo.owner && repo.repo_name)) {
    return ''
  }
  return getGitHubRepoPath(repo.owner, repo.repo_name)
}
