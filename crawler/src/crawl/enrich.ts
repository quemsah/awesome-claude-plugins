import type Database from 'better-sqlite3'
import type { GitHubReader, GitHubRepo, RepoResult } from '../github/client.js'
import { parseRepositoryUrl } from '../github/repositoryUrl.js'
import {
  deleteById,
  getRepositoryById,
  listForEnrichment,
  type RepositoryRow,
  rebindCanonicalUrl,
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

function recordProblem(
  db: Database.Database,
  runId: string,
  counts: EnrichmentCounts,
  row: RepositoryRow,
  errorType: string,
  previouslyReady: boolean,
  warning = false,
): void {
  recordRunError(db, {
    run_id: runId,
    phase: 'enrich',
    repository_id: row.id,
    error_type: errorType,
    retry_count: 0,
    occurred_at: new Date().toISOString(),
  })
  if (warning) counts.warnings++
  if (previouslyReady) counts.unchangedOnError++
  else counts.newIncomplete++
}

type EnrichmentTarget = { id: number; ready: boolean; owner: string; repo: string; ownerUrl: string }

function resolveTarget(
  db: Database.Database,
  row: RepositoryRow,
  identity: NonNullable<ReturnType<typeof parseRepositoryUrl>>,
  canonical: CanonicalIdentity,
  previouslyReady: boolean,
  removedIds: Set<number>,
): EnrichmentTarget {
  const moved = canonical.htmlUrl.toLowerCase() !== row.html_url?.toLowerCase()
  if (!moved)
    return {
      id: row.id,
      ready: previouslyReady,
      owner: identity.owner,
      repo: identity.repo,
      ownerUrl: `https://github.com/${identity.owner}`,
    }
  const rebound = rebindCanonicalUrl(db, row.id, canonical.htmlUrl)
  if (rebound.removedId !== null) removedIds.add(rebound.removedId)
  const target = getRepositoryById(db, rebound.id)
  if (!target) throw new Error('Canonical repository disappeared during rebind')
  return {
    id: rebound.id,
    ready: previouslyReady || wasReady(target),
    owner: canonical.owner,
    repo: canonical.repo,
    ownerUrl: canonical.ownerUrl,
  }
}

async function loadRepository(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  row: RepositoryRow,
  identity: NonNullable<ReturnType<typeof parseRepositoryUrl>>,
  previouslyReady: boolean,
  counts: EnrichmentCounts,
  removedIds: Set<number>,
): Promise<{ data: GitHubRepo; target: EnrichmentTarget } | null> {
  const result = await reader.getRepository(identity.owner, identity.repo)
  if (result.kind === 'not-found') {
    deleteById(db, row.id)
    counts.deleted404++
    counts.conclusive++
    return null
  }
  if (result.kind === 'temporary-error') {
    recordProblem(db, runId, counts, row, temporaryCategory('repository', result), previouslyReady)
    return null
  }
  const canonical = canonicalIdentity(result.data)
  if (!canonical) {
    recordProblem(db, runId, counts, row, 'repository_identity_mismatch', previouslyReady, true)
    return null
  }
  return { data: result.data, target: resolveTarget(db, row, identity, canonical, previouslyReady, removedIds) }
}

async function enrichOne(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  row: RepositoryRow,
  counts: EnrichmentCounts,
  removedIds: Set<number>,
): Promise<void> {
  if (!row.html_url?.trim()) {
    deleteById(db, row.id)
    counts.deletedBlankUrl++
    return
  }
  const previouslyReady = wasReady(row)
  const identity = parseRepositoryUrl(row.html_url)
  if (!identity) {
    recordProblem(db, runId, counts, row, 'invalid_repository_url', previouslyReady, true)
    return
  }
  const loaded = await loadRepository(db, reader, runId, row, identity, previouslyReady, counts, removedIds)
  if (!loaded) return
  const { data, target } = loaded
  const marketplace = await reader.getMarketplace(target.owner, target.repo)
  if (marketplace.kind === 'not-found') {
    deleteById(db, target.id)
    counts.deleted404++
    counts.conclusive++
    return
  }
  if (marketplace.kind === 'temporary-error') {
    const repository = getRepositoryById(db, target.id) ?? row
    recordProblem(db, runId, counts, repository, temporaryCategory('marketplace', marketplace), target.ready)
    return
  }
  updateEnriched(db, target.id, {
    stargazers_count: data.stargazers_count,
    forks_count: data.forks_count,
    subscribers_count: data.subscribers_count,
    description: data.description,
    owner: target.owner,
    owner_url: target.ownerUrl,
    repo_name: target.repo,
    repo_updated: data.pushed_at,
    plugins_count: marketplace.data.plugins.length,
  })
  counts.conclusive++
  if (target.ready) counts.updated++
  else counts.newReady++
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
  let lastId = 0
  const removedIds = new Set<number>()
  while (true) {
    const rows = listForEnrichment(db, lastId, 50)
    if (rows.length === 0) break
    for (const row of rows) {
      lastId = row.id
      if (removedIds.has(row.id)) continue
      await enrichOne(db, reader, runId, row, counts, removedIds)
    }
    onBatchComplete?.()
  }
  return counts
}
