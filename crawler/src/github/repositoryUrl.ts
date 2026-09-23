import { parseGitHubRepositoryUrl } from './identifiers.js'

export type RepositoryIdentity = { owner: string; repo: string }

export function parseRepositoryUrl(url: string): RepositoryIdentity | null {
  return parseGitHubRepositoryUrl(url) ?? null
}
