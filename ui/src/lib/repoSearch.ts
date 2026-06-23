import reposData from '../data/repos.json' with { type: 'json' }
import type { Repo } from '../schemas/repo.schema.ts'
import { ReposArraySchema } from '../schemas/repo.schema.ts'

export type SortOption = 'stars-desc' | 'forks-desc' | 'plugins-desc'

export interface RepoSearchRequest {
  query?: string
  sortOption?: SortOption
  page?: number
  pageSize?: number
}

export interface RepoSearchResult {
  repos: Repo[]
  query: string
  sortOption: SortOption
  page: number
  pageSize: number
  totalRepoCount: number
  totalPluginCount: number
  hasMore: boolean
}

export const DEFAULT_PAGE_SIZE = 24
export const MAX_PAGE_SIZE = 48
const whitespaceRegex = /\s+/

let validatedRepos: Repo[] | null = null

export function parseSortOption(value: string | null | undefined): SortOption {
  if (value === 'forks-desc' || value === 'plugins-desc') {
    return value
  }
  return 'stars-desc'
}

export function searchRepos({
  query = '',
  sortOption = 'stars-desc',
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
}: RepoSearchRequest): RepoSearchResult {
  const normalizedQuery = query.trim()
  const safePage = Math.max(1, Math.floor(page))
  const safePageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize)))
  const filteredRepos = filterRepos(getRepos(), normalizedQuery)
  const sortedRepos = sortRepos(filteredRepos, sortOption)
  const start = (safePage - 1) * safePageSize
  const end = start + safePageSize
  const repos = sortedRepos.slice(start, end)

  return {
    repos,
    query: normalizedQuery,
    sortOption,
    page: safePage,
    pageSize: safePageSize,
    totalRepoCount: filteredRepos.length,
    totalPluginCount: filteredRepos.reduce((total, repo) => total + (repo.plugins_count || 0), 0),
    hasMore: end < filteredRepos.length,
  }
}

function getRepos(): Repo[] {
  if (validatedRepos) {
    return validatedRepos
  }

  const validationResult = ReposArraySchema.safeParse(reposData)
  if (!validationResult.success) {
    console.error('Failed to validate repositories:', validationResult.error)
    validatedRepos = []
    return validatedRepos
  }

  validatedRepos = validationResult.data.filter((repo) => repo.repo_name !== null)
  return validatedRepos
}

function filterRepos(repos: Repo[], query: string): Repo[] {
  const terms = normalize(query).split(whitespaceRegex).filter(Boolean)

  if (terms.length === 0) {
    return repos
  }

  return repos.filter((repo) => {
    const searchableText = normalize([repo.owner, repo.repo_name, repo.description].filter(Boolean).join(' '))
    return terms.every((term) => searchableText.includes(term))
  })
}

function sortRepos(repos: Repo[], sortOption: SortOption): Repo[] {
  return [...repos].sort((a, b) => {
    switch (sortOption) {
      case 'forks-desc':
        return (b.forks_count ?? 0) - (a.forks_count ?? 0)
      case 'plugins-desc':
        return (b.plugins_count ?? 0) - (a.plugins_count ?? 0)
      default:
        return (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0)
    }
  })
}

function normalize(value: string): string {
  return value.toLowerCase().normalize('NFKD')
}
