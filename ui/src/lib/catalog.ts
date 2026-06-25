/** biome-ignore-all lint/style/useNamingConvention: catalog data uses snake_case fields */
import reposData from '../data/repos.json' with { type: 'json' }
import statsData from '../data/stats.json' with { type: 'json' }
import type { Repo } from '../schemas/repo.schema.ts'

const FALLBACK_LAST_MODIFIED = new Date('2026-01-01T00:00:00.000Z')

interface StatsEntry {
  date: string
  size: number
  id: number
}

export type CatalogRepo = Repo & { owner: string; repo_name: string }

const catalogRepos: CatalogRepo[] = (reposData as Repo[]).filter(
  (repo): repo is CatalogRepo => repo.owner !== null && repo.repo_name !== null
)

export function getCatalogRepos(): readonly CatalogRepo[] {
  return catalogRepos
}

export function findCatalogRepo(repoPath: string) {
  const normalizedPath = repoPath.toLowerCase()
  return getCatalogRepos().find((repo) => `${repo.owner}/${repo.repo_name}`.toLowerCase() === normalizedPath)
}

export function getCatalogLastModified() {
  const latestStat = (statsData as StatsEntry[]).at(-1)
  const parsedDate = latestStat ? new Date(latestStat.date) : FALLBACK_LAST_MODIFIED

  if (Number.isNaN(parsedDate.getTime())) {
    return FALLBACK_LAST_MODIFIED
  }

  return parsedDate
}

export function getRepoCanonicalPath(repo: CatalogRepo) {
  return `${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo_name)}`
}

export function getRepoSitemapPriority(repo: CatalogRepo) {
  return repo.plugins_count === null ? 0.3 : 0.5
}
