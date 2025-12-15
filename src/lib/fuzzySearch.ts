import Fuse from 'fuse.js'
import type { Repo } from '../app/types/repo.type.ts'

export const fuseOptions = {
  keys: ['repo_name', 'description'],
  includeScore: true,
  threshold: 0.2,
  ignoreLocation: true,
  includeMatches: true,
  minMatchCharLength: 2,
  findAllMatches: true,
}

let fuseCache: WeakMap<Repo[], Fuse<Repo>> | null = null

function getCachedFuseIndex(repos: Repo[]): Fuse<Repo> {
  if (!fuseCache) {
    fuseCache = new WeakMap()
  }

  let fuse = fuseCache.get(repos)
  if (!fuse) {
    fuse = new Fuse(repos, fuseOptions)
    fuseCache.set(repos, fuse)
  }
  return fuse
}

export function createFuseIndex(repos: Repo[]): Fuse<Repo> {
  return getCachedFuseIndex(repos)
}
