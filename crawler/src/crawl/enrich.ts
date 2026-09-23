import type Database from 'better-sqlite3'
import type { GitHubReader, GitHubRepo, RepoResult } from '../github/client.js'
import { parseRepositoryUrl } from '../github/repositoryUrl.js'
import { deleteById, listForEnrichment, type RepositoryRow, updateEnriched } from '../storage/repositories.js'
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

function matchesIdentity(data: GitHubRepo, url: string, owner: string, repo: string): boolean {
  const identity = parseRepositoryUrl(data.html_url)
  return (
    identity !== null &&
    data.html_url.toLowerCase() === url.toLowerCase() &&
    /^[A-Za-z0-9._-]+$/.test(data.owner.login) &&
    data.owner.login.toLowerCase() === owner.toLowerCase() &&
    /^https:\/\/github\.com\/[A-Za-z0-9._-]+$/.test(data.owner.html_url) &&
    data.owner.html_url.toLowerCase() === `https://github.com/${owner}`.toLowerCase() &&
    /^[A-Za-z0-9._-]+$/.test(data.name) &&
    data.name.toLowerCase() === repo.toLowerCase()
  )
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
  while (true) {
    const rows = listForEnrichment(db, lastId, 50)
    if (rows.length === 0) break
    for (const row of rows) {
      lastId = row.id
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
      if (!matchesIdentity(repository.data, row.html_url, owner, repo)) {
        problem(row, 'repository_identity_mismatch', previouslyReady, true)
        continue
      }
      const marketplace = await reader.getMarketplace(owner, repo)
      if (marketplace.kind === 'not-found') {
        deleteById(db, row.id)
        counts.deleted404++
        counts.conclusive++
        continue
      }
      if (marketplace.kind === 'temporary-error') {
        problem(row, temporaryCategory('marketplace', marketplace), previouslyReady)
        continue
      }
      updateEnriched(db, row.id, {
        stargazers_count: repository.data.stargazers_count,
        forks_count: repository.data.forks_count,
        subscribers_count: repository.data.subscribers_count,
        description: repository.data.description,
        owner,
        owner_url: `https://github.com/${owner}`,
        repo_name: repo,
        repo_updated: repository.data.pushed_at,
        plugins_count: marketplace.data.plugins.length,
      })
      counts.conclusive++
      if (previouslyReady) counts.updated++
      else counts.newReady++
    }
    onBatchComplete?.()
  }
  return counts
}
