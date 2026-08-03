import Fuse from 'fuse.js'
import type { Repo } from '../schemas/repo.schema.ts'

export const fuseOptions = {
  keys: [
    'repo_name',
    'owner',
    'description',
    'plugin_names',
    'plugin_descriptions',
    'plugin_categories',
    'plugin_keywords',
    'plugin_commands',
    'plugin_agents',
    'plugin_mcp_servers',
  ],
  includeScore: true,
  threshold: 0.2,
  ignoreLocation: true,
  includeMatches: true,
  minMatchCharLength: 2,
  findAllMatches: true,
}

let fuseCache: WeakMap<readonly Repo[], Fuse<Repo>> | null = null

function getCachedFuseIndex(repos: readonly Repo[]): Fuse<Repo> {
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

export function createFuseIndex(repos: readonly Repo[]): Fuse<Repo> {
  return getCachedFuseIndex(repos)
}
