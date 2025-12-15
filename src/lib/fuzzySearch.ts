import Fuse from 'fuse.js'
import type { Repo } from '../app/types/repo.type.ts'

const fuseOptions = {
  keys: ['repo_name', 'description'],
  includeScore: true,
  threshold: 0.4,
  ignoreLocation: true,
  includeMatches: true,
  minMatchCharLength: 2,
  findAllMatches: true,
  useExtendedSearch: true,
}

function createFuseIndex(repos: Repo[]): Fuse<Repo> {
  return new Fuse(repos, fuseOptions)
}

export function fuzzySearchRepos(repos: Repo[], searchTerm: string): Repo[] {
  if (!searchTerm.trim()) return repos

  const fuse = createFuseIndex(repos)
  const results = fuse.search(searchTerm)

  return results.map((result) => result.item)
}
