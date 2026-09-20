import { type GitHubRepository, GitHubRepositorySchema } from '../schemas/github.schema.ts'
import type { CatalogSnapshotReason } from './repositorySnapshot.ts'

export type RequestedRepository = { owner: string; repoName: string }

export type LiveRepositoryResult = { ok: true; repository: GitHubRepository } | { ok: false; reason: CatalogSnapshotReason }

/**
 * The browser asks GitHub for one repository and keeps the catalog data on any mismatch, so a
 * redirect to a renamed owner cannot feed links and names the page never claimed to show.
 */
export function readLiveRepository(status: number, payload: unknown, requested: RequestedRepository): LiveRepositoryResult {
  if (status === 404) {
    return { ok: false, reason: 'github-not-found' }
  }

  const parsed = GitHubRepositorySchema.safeParse(payload)
  if (!parsed.success) {
    return { ok: false, reason: 'github-unavailable' }
  }

  const matchesRequest =
    parsed.data.owner.login.toLowerCase() === requested.owner.toLowerCase() &&
    parsed.data.name.toLowerCase() === requested.repoName.toLowerCase()

  return matchesRequest ? { ok: true, repository: parsed.data } : { ok: false, reason: 'github-unavailable' }
}
