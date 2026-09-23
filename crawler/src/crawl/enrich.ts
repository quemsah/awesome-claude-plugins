import type Database from 'better-sqlite3'
import type { GitHubReader, GitHubRepo, RepoResult } from '../github/client.js'
import { isValidGitHubPathSegment, parseGitHubOwnerUrl } from '../github/identifiers.js'
import type { GitHubGraphQLRepo } from '../github/client.js'
import { parseRepositoryUrl } from '../github/repositoryUrl.js'
import {
  deleteById,
  deleteCanonicalRows,
  getRepositoryById,
  listForEnrichment,
  type RepositoryRow,
  rebindCanonicalUrl,
  updateEnriched,
} from '../storage/repositories.js'
import { recordRunError, runWhileActive } from '../storage/runs.js'

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
  const ownerFromUrl = parseGitHubOwnerUrl(data.owner.html_url)
  if (
    identity === null ||
    !isValidGitHubPathSegment(data.owner.login) ||
    data.owner.login.toLowerCase() !== identity.owner.toLowerCase() ||
    ownerFromUrl === undefined ||
    ownerFromUrl.toLowerCase() !== identity.owner.toLowerCase() ||
    !isValidGitHubPathSegment(data.name) ||
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
  now: () => string = () => new Date().toISOString(),
  retryCount = 0,
): void {
  runWhileActive(db, runId, () => {
    recordRunError(db, {
      run_id: runId,
      phase: 'enrich',
      repository_id: row.id,
      error_type: errorType,
      retry_count: retryCount,
      occurred_at: now(),
    })
  })
  if (warning) counts.warnings++
  if (previouslyReady) counts.unchangedOnError++
  else counts.newIncomplete++
}

type LoadedRepository = {
  data: GitHubRepo
  canonical: CanonicalIdentity
  moved: boolean
  ready: boolean
  owner: string
  repo: string
  ownerUrl: string
  githubNodeId: string | null
  marketplaceOid: string | null
  repositoryEtag: string | null
}
type EnrichmentTarget = { id: number; removedId: number | null; ready: boolean }

function persistEnrichment(
  db: Database.Database,
  runId: string,
  row: RepositoryRow,
  loaded: LoadedRepository,
  pluginsCount: number,
  marketplaceOid: string | null,
  marketplaceEtag: string | null,
  at: string,
): EnrichmentTarget {
  return runWhileActive(db, runId, () => {
    const rebound = loaded.moved ? rebindCanonicalUrl(db, row.id, loaded.canonical.htmlUrl, at) : { id: row.id, removedId: null }
    const target = loaded.moved ? getRepositoryById(db, rebound.id) : null
    if (loaded.moved && !target) throw new Error('Canonical repository disappeared during rebind')
    const ready = loaded.ready
    updateEnriched(
      db,
      rebound.id,
      {
        stargazers_count: loaded.data.stargazers_count,
        forks_count: loaded.data.forks_count,
        subscribers_count: loaded.data.subscribers_count,
        description: loaded.data.description,
        owner: loaded.owner,
        owner_url: loaded.ownerUrl,
        repo_name: loaded.repo,
        repo_updated: loaded.data.pushed_at,
        plugins_count: pluginsCount,
        github_node_id: loaded.githubNodeId,
        marketplace_oid: marketplaceOid,
        repository_etag: loaded.repositoryEtag,
        marketplace_etag: marketplaceEtag,
      },
      at,
    )
    return { id: rebound.id, removedId: rebound.removedId, ready }
  })
}

async function loadRepository(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  row: RepositoryRow,
  identity: NonNullable<ReturnType<typeof parseRepositoryUrl>>,
  previouslyReady: boolean,
  counts: EnrichmentCounts,
  now: () => string,
): Promise<LoadedRepository | null> {
  const result = row.repository_etag
    ? await reader.getRepository(identity.owner, identity.repo, row.repository_etag)
    : await reader.getRepository(identity.owner, identity.repo)
  if (result.kind === 'not-found') {
    runWhileActive(db, runId, () => {
      deleteById(db, row.id)
    })
    counts.deleted404++
    counts.conclusive++
    return null
  }
  if (result.kind === 'temporary-error') {
    recordProblem(db, runId, counts, row, temporaryCategory('repository', result), previouslyReady, false, now, result.retryCount)
    return null
  }
  if (result.kind === 'not-modified') {
    recordProblem(db, runId, counts, row, 'repository_not_modified_without_data', previouslyReady)
    return null
  }
  const canonical = canonicalIdentity(result.data)
  if (!canonical) {
    recordProblem(db, runId, counts, row, 'repository_identity_mismatch', previouslyReady, true, now)
    return null
  }
  const moved = canonical.htmlUrl !== row.html_url
  const duplicate = moved
    ? (db
        .prepare('SELECT * FROM repositories WHERE html_url = ? COLLATE NOCASE AND id != ? ORDER BY id LIMIT 1')
        .get(canonical.htmlUrl, row.id) as RepositoryRow | undefined)
    : undefined
  return {
    data: result.data,
    canonical,
    moved,
    ready: previouslyReady || (duplicate !== undefined && wasReady(duplicate)),
    owner: moved ? canonical.owner : identity.owner,
    repo: moved ? canonical.repo : identity.repo,
    ownerUrl: moved ? canonical.ownerUrl : `https://github.com/${identity.owner}`,
    githubNodeId: result.data.node_id ?? row.github_node_id,
    marketplaceOid: row.marketplace_oid,
    repositoryEtag: result.etag ?? row.repository_etag,
  }
}

async function enrichOne(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  row: RepositoryRow,
  counts: EnrichmentCounts,
  removedIds: Set<number>,
  now: () => string,
  onProgress?: () => void,
): Promise<void> {
  if (!row.html_url?.trim()) {
    runWhileActive(db, runId, () => {
      deleteById(db, row.id)
    })
    counts.deletedBlankUrl++
    return
  }
  const previouslyReady = wasReady(row)
  const identity = parseRepositoryUrl(row.html_url)
  if (!identity) {
    recordProblem(db, runId, counts, row, 'invalid_repository_url', previouslyReady, true, now)
    return
  }
  onProgress?.()
  const loaded = await loadRepository(db, reader, runId, row, identity, previouslyReady, counts, now)
  if (!loaded) return
  onProgress?.()
  const marketplace = row.marketplace_etag
    ? await reader.getMarketplace(loaded.owner, loaded.repo, row.marketplace_etag)
    : await reader.getMarketplace(loaded.owner, loaded.repo)
  if (marketplace.kind === 'not-found') {
    runWhileActive(db, runId, () => {
      if (loaded.moved) {
        const removedId = deleteCanonicalRows(db, row.id, loaded.canonical.htmlUrl)
        if (removedId !== null) removedIds.add(removedId)
      } else deleteById(db, row.id)
    })
    counts.deleted404++
    counts.conclusive++
    return
  }
  if (marketplace.kind === 'temporary-error') {
    recordProblem(db, runId, counts, row, temporaryCategory('marketplace', marketplace), loaded.ready, false, now, marketplace.retryCount)
    return
  }
  const pluginsCount = marketplace.kind === 'not-modified' ? row.plugins_count : marketplace.data.plugins.length
  if (pluginsCount === null) {
    recordProblem(db, runId, counts, row, 'marketplace_not_modified_without_data', loaded.ready, false, now)
    return
  }
  const marketplaceOid = marketplace.kind === 'found' ? (marketplace.data.oid ?? row.marketplace_oid) : row.marketplace_oid
  const target = persistEnrichment(db, runId, row, loaded, pluginsCount, marketplaceOid, marketplace.etag ?? row.marketplace_etag, now())
  if (target.removedId !== null) removedIds.add(target.removedId)
  counts.conclusive++
  if (target.ready) counts.updated++
  else counts.newReady++
}

function loadGraphQLRepository(db: Database.Database, row: RepositoryRow, data: GitHubGraphQLRepo): LoadedRepository | null {
  const canonical = canonicalIdentity(data)
  if (!canonical) return null
  const moved = canonical.htmlUrl !== row.html_url
  const duplicate = moved
    ? (db
        .prepare('SELECT * FROM repositories WHERE html_url = ? COLLATE NOCASE AND id != ? ORDER BY id LIMIT 1')
        .get(canonical.htmlUrl, row.id) as RepositoryRow | undefined)
    : undefined
  return {
    data,
    canonical,
    moved,
    ready: wasReady(row) || (duplicate !== undefined && wasReady(duplicate)),
    owner: canonical.owner,
    repo: canonical.repo,
    ownerUrl: canonical.ownerUrl,
    githubNodeId: data.node_id,
    marketplaceOid: data.marketplace_oid,
    repositoryEtag: row.repository_etag,
  }
}

async function enrichGraphQLOne(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  row: RepositoryRow,
  data: GitHubGraphQLRepo | null,
  counts: EnrichmentCounts,
  removedIds: Set<number>,
  now: () => string,
): Promise<void> {
  if (removedIds.has(row.id)) return
  if (data === null || data.private) {
    runWhileActive(db, runId, () => deleteById(db, row.id))
    counts.deleted404++
    counts.conclusive++
    return
  }
  const loaded = loadGraphQLRepository(db, row, data)
  if (!loaded) {
    recordProblem(db, runId, counts, row, 'repository_identity_mismatch', wasReady(row), true, now)
    return
  }
  if (!loaded.marketplaceOid) {
    if (loaded.moved) {
      const removedId = runWhileActive(db, runId, () => deleteCanonicalRows(db, row.id, loaded.canonical.htmlUrl))
      if (removedId !== null) removedIds.add(removedId)
    } else runWhileActive(db, runId, () => deleteById(db, row.id))
    counts.deleted404++
    counts.conclusive++
    return
  }

  let pluginsCount = row.plugins_count
  let marketplaceOid = loaded.marketplaceOid
  let marketplaceEtag = row.marketplace_etag
  if (row.marketplace_oid !== loaded.marketplaceOid || pluginsCount === null) {
    const changedOid = row.marketplace_oid !== loaded.marketplaceOid
    const marketplace =
      row.marketplace_etag && !changedOid
        ? await reader.getMarketplace(loaded.owner, loaded.repo, row.marketplace_etag)
        : await reader.getMarketplace(loaded.owner, loaded.repo)
    if (marketplace.kind === 'not-found') {
      if (loaded.moved) {
        const removedId = runWhileActive(db, runId, () => deleteCanonicalRows(db, row.id, loaded.canonical.htmlUrl))
        if (removedId !== null) removedIds.add(removedId)
      } else runWhileActive(db, runId, () => deleteById(db, row.id))
      counts.deleted404++
      counts.conclusive++
      return
    }
    if (marketplace.kind === 'temporary-error') {
      recordProblem(db, runId, counts, row, temporaryCategory('marketplace', marketplace), loaded.ready, false, now, marketplace.retryCount)
      return
    }
    if (marketplace.kind === 'not-modified') {
      if (changedOid) {
        recordProblem(db, runId, counts, row, 'marketplace_not_modified_after_oid_change', loaded.ready, true, now)
        return
      }
      if (pluginsCount === null) {
        recordProblem(db, runId, counts, row, 'marketplace_not_modified_without_data', loaded.ready, false, now)
        return
      }
    } else {
      pluginsCount = marketplace.data.plugins.length
      marketplaceOid = marketplace.data.oid ?? loaded.marketplaceOid
    }
    marketplaceEtag = marketplace.etag ?? marketplaceEtag
  }

  if (pluginsCount === null) {
    recordProblem(db, runId, counts, row, 'marketplace_count_missing', loaded.ready, false, now)
    return
  }
  const target = persistEnrichment(db, runId, row, loaded, pluginsCount, marketplaceOid, marketplaceEtag, now())
  if (target.removedId !== null) removedIds.add(target.removedId)
  counts.conclusive++
  if (target.ready) counts.updated++
  else counts.newReady++
}

async function enrichGraphQLBatch(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  rows: RepositoryRow[],
  counts: EnrichmentCounts,
  removedIds: Set<number>,
  state: { size: number; stableBatches: number },
  now: () => string,
  onProgress?: () => void,
): Promise<void> {
  const getBatch = reader.getRepositoriesByNodeId
  if (!getBatch) {
    for (const row of rows) await enrichOne(db, reader, runId, row, counts, removedIds, now, onProgress)
    return
  }
  const ids = rows.map((row) => row.github_node_id as string)
  onProgress?.()
  const startedAt = Date.now()
  const result = await getBatch.call(reader, ids)
  const latency = Date.now() - startedAt
  if (result.kind === 'temporary-error') {
    state.stableBatches = 0
    const smallerSize = rows.length > 25 ? 25 : 10
    if (rows.length > 10) {
      state.size = smallerSize
      for (let offset = 0; offset < rows.length; offset += smallerSize) {
        await enrichGraphQLBatch(db, reader, runId, rows.slice(offset, offset + smallerSize), counts, removedIds, state, now, onProgress)
      }
    } else {
      for (const row of rows) recordProblem(db, runId, counts, row, 'graphql_temporary_error', wasReady(row), true, now)
    }
    return
  }
  if (latency >= 8_000 || result.rateLimit.cost > 50) {
    state.stableBatches = 0
    state.size = rows.length > 25 ? 25 : 10
  } else {
    state.stableBatches++
    if (state.stableBatches >= 5) state.size = 50
  }
  for (const [index, row] of rows.entries()) {
    await enrichGraphQLOne(db, reader, runId, row, result.data[index] ?? null, counts, removedIds, now)
  }
}

export async function enrichRepositories(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  onProgress?: () => void,
  now: () => string = () => new Date().toISOString(),
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
  const batchState = { size: 25, stableBatches: 0 }
  while (true) {
    const rows = listForEnrichment(db, lastId, 50)
    if (rows.length === 0) break
    for (const row of rows) {
      lastId = row.id
    }
    const graphQLRows = rows.filter((row) => row.github_node_id && parseRepositoryUrl(row.html_url ?? ''))
    const legacyRows = rows.filter((row) => !row.github_node_id || !parseRepositoryUrl(row.html_url ?? ''))
    for (const row of legacyRows) {
      if (!removedIds.has(row.id)) await enrichOne(db, reader, runId, row, counts, removedIds, now, onProgress)
    }
    for (let offset = 0; offset < graphQLRows.length; ) {
      const batch = graphQLRows.slice(offset, offset + batchState.size)
      offset += batch.length
      await enrichGraphQLBatch(db, reader, runId, batch, counts, removedIds, batchState, now, onProgress)
    }
    onProgress?.()
  }
  return counts
}
