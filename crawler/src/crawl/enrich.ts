import type Database from 'better-sqlite3'
import type { GitHubReader, GitHubRepo, RepoResult } from '../github/client.js'
import { parseRepositoryUrl } from '../github/repositoryUrl.js'
import {
  deleteById,
  getRepositoryById,
  listForEnrichment,
  rebindCanonicalUrl,
  type RepositoryRow,
  updateEnriched,
} from '../storage/repositories.js'
import { recordRunError } from '../storage/runs.js'

export type EnrichmentCounts = {
  updated: number
  unchangedOnError: number
  newReady: number
  newIncomplete: number
  deleted404: number
  deletedBlankUrl: number
  conclusive: number
  warnings: number
}

function wasReady(row: RepositoryRow): boolean {
  if (!row.html_url) return false
  const identity = parseRepositoryUrl(row.html_url)
  return (
    identity !== null &&
    row.owner === identity.owner &&
    row.repo_name === identity.repo &&
    row.owner_url === `https://github.com/${identity.owner}` &&
    [row.stargazers_count, row.forks_count, row.subscribers_count].every(
      (value) => Number.isSafeInteger(value) && value !== null && value >= 0,
    ) &&
    (row.plugins_count === null || (Number.isSafeInteger(row.plugins_count) && row.plugins_count >= 0))
  )
}

type CanonicalIdentity = {
  htmlUrl: string
  owner: string
  ownerUrl: string
  repo: string
}

function canonicalIdentity(data: GitHubRepo): CanonicalIdentity | null {
  const identity = parseRepositoryUrl(data.html_url)
  if (
    identity === null ||
    !/^[A-Za-z0-9._-]+$/.test(data.owner.login) ||
    data.owner.login.toLowerCase() !== identity.owner.toLowerCase() ||
    !/^https:\/\/github\.com\/[A-Za-z0-9._-]+$/.test(data.owner.html_url) ||
    data.owner.html_url.toLowerCase() !== `https://github.com/${identity.owner}`.toLowerCase() ||
    !/^[A-Za-z0-9._-]+$/.test(data.name) ||
    data.name.toLowerCase() !== identity.repo.toLowerCase()
  ) {
    return null
  }
  return {
    htmlUrl: `https://github.com/${identity.owner}/${identity.repo}`,
    owner: identity.owner,
    ownerUrl: `https://github.com/${identity.owner}`,
    repo: identity.repo,
  }
}

function temporaryCategory(
  endpoint: 'repository' | 'marketplace',
  result: Extract<RepoResult<unknown>, { kind: 'temporary-error' }>,
): string {
  if (result.status === 429) return `${endpoint}_rate_limited`
  if (result.reason === 'Invalid GitHub response') return `${endpoint}_invalid_response`
  return `${endpoint}_temporary_error`
}

export async function enrichRepositories(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  onBatchComplete?: () => void,
): Promise<EnrichmentCounts> {
  const counts: EnrichmentCounts = {
    updated: 0,
    unchangedOnError: 0,
    newReady: 0,
    newIncomplete: 0,
    deleted404: 0,
    deletedBlankUrl: 0,
    conclusive: 0,
    warnings: 0,
  }
  const problem = (row: RepositoryRow, error_type: string, previouslyReady: boolean, warning = false): void => {
    recordRunError(db, {
      run_id: runId,
      phase: 'enrich',
      repository_id: row.id,
      error_type,
      retry_count: 0,
      occurred_at: new Date().toISOString(),
    })
    if (warning) counts.warnings++
    if (previouslyReady) counts.unchangedOnError++
    else counts.newIncomplete++
  }

  let lastId = 0
  const removedIds = new Set<number>()
  while (true) {
    const rows = listForEnrichment(db, lastId, 50)
    if (rows.length === 0) break
    for (const row of rows) {
      lastId = row.id
      if (removedIds.has(row.id)) continue
      if (!row.html_url?.trim()) {
        deleteById(db, row.id)
        counts.deletedBlankUrl++
        continue
      }
      const previouslyReady = wasReady(row)
      const identity = parseRepositoryUrl(row.html_url)
      if (!identity) {
        problem(row, 'invalid_repository_url', previouslyReady, true)
        continue
      }
      const { owner, repo } = identity
      const repository = await reader.getRepository(owner, repo)
      if (repository.kind === 'not-found') {
        deleteById(db, row.id)
        counts.deleted404++
        counts.conclusive++
        continue
      }
      if (repository.kind === 'temporary-error') {
        problem(row, temporaryCategory('repository', repository), previouslyReady)
        continue
      }
      const canonical = canonicalIdentity(repository.data)
      if (!canonical) {
        problem(row, 'repository_identity_mismatch', previouslyReady, true)
        continue
      }

      const moved = canonical.htmlUrl.toLowerCase() !== row.html_url.toLowerCase()
      let targetId = row.id
      let targetReady = previouslyReady
      let targetOwner = owner
      let targetRepo = repo
      let targetOwnerUrl = `https://github.com/${owner}`
      if (moved) {
        const rebound = rebindCanonicalUrl(db, row.id, canonical.htmlUrl)
        targetId = rebound.id
        if (rebound.removedId !== null) removedIds.add(rebound.removedId)
        const target = getRepositoryById(db, targetId)
        if (!target) throw new Error('Canonical repository disappeared during rebind')
        targetReady = previouslyReady || wasReady(target)
        targetOwner = canonical.owner
        targetRepo = canonical.repo
        targetOwnerUrl = canonical.ownerUrl
      }

      const marketplace = await reader.getMarketplace(targetOwner, targetRepo)
      if (marketplace.kind === 'not-found') {
        deleteById(db, targetId)
        counts.deleted404++
        counts.conclusive++
        continue
      }
      if (marketplace.kind === 'temporary-error') {
        const target = getRepositoryById(db, targetId) ?? row
        problem(target, temporaryCategory('marketplace', marketplace), targetReady)
        continue
      }
      updateEnriched(db, targetId, {
        stargazers_count: repository.data.stargazers_count,
        forks_count: repository.data.forks_count,
        subscribers_count: repository.data.subscribers_count,
        description: repository.data.description,
        owner: targetOwner,
        owner_url: targetOwnerUrl,
        repo_name: targetRepo,
        repo_updated: repository.data.pushed_at,
        plugins_count: marketplace.data.plugins.length,
      })
      counts.conclusive++
      if (targetReady) counts.updated++
      else counts.newReady++
    }
    onBatchComplete?.()
  }
  return counts
}
