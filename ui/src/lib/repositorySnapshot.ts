/** biome-ignore-all lint/style/useNamingConvention: Snapshot mirrors GitHub API field names. */

import { type GitHubRepository, GitHubRepositorySchema } from '../schemas/github.schema.ts'
import type { Repo } from '../schemas/repo.schema.ts'

/** Why the repository page fell back to catalog data instead of live GitHub metadata. */
export type CatalogSnapshotReason = 'github-not-found' | 'github-unavailable'

/**
 * Catalog data is what the repository page renders before the browser reaches GitHub, so fields
 * the catalog never recorded stay unknown instead of being shown as zero or a placeholder date.
 */
export function createCatalogRepositorySnapshot(repo: Repo): GitHubRepository {
  if (!(repo.owner && repo.repo_name && repo.owner_url)) {
    throw new Error('Catalog repository is missing canonical identity fields')
  }

  return GitHubRepositorySchema.parse({
    created_at: null,
    default_branch: 'HEAD',
    description: repo.description,
    forks_count: repo.forks_count ?? 0,
    html_url: repo.html_url,
    homepage: null,
    language: null,
    license: null,
    name: repo.repo_name,
    open_issues_count: null,
    owner: {
      avatar_url: null,
      html_url: repo.owner_url,
      login: repo.owner,
      type: null,
    },
    pushed_at: null,
    size: null,
    stargazers_count: repo.stargazers_count ?? 0,
    subscribers_count: repo.subscribers_count ?? 0,
    topics: [],
    updated_at: null,
  })
}
