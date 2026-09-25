import { parseMarketplaceManifest } from '@awesome-claude-plugins/marketplace-contract'
import type Database from 'better-sqlite3'
import type { GitHubGraphQLMarketplace, GitHubGraphQLRepo, GitHubReader, GitHubRepo, RepoResult } from '../github/client.js'
import { isValidGitHubPathSegment, parseGitHubOwnerUrl } from '../github/identifiers.js'
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
  marketplaceParserVersion: number,
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
        marketplace_parser_version: marketplaceParserVersion,
      },
      at,
    )
    return { id: rebound.id, removedId: rebound.removedId, ready }
  })
}

function removeLoadedRepository(
  db: Database.Database,
  runId: string,
  row: RepositoryRow,
  loaded: LoadedRepository,
  counts: EnrichmentCounts,
  removedIds: Set<number>,
): void {
  const removedId = runWhileActive(db, runId, () => {
    if (loaded.moved) return deleteCanonicalRows(db, row.id, loaded.canonical.htmlUrl)
    deleteById(db, row.id)
    return null
  })
  if (removedId !== null) removedIds.add(removedId)
  counts.deleted404++
  counts.conclusive++
}

function completeEnrichment(counts: EnrichmentCounts, target: EnrichmentTarget, removedIds: Set<number>): void {
  if (target.removedId !== null) removedIds.add(target.removedId)
  counts.conclusive++
  if (target.ready) counts.updated++
  else counts.newReady++
}

const MARKETPLACE_PARSER_VERSION = 1

type MarketplaceState = {
  pluginsCount: number
  marketplaceOid: string | null
  marketplaceEtag: string | null
  parserVersion: number
}

async function loadLegacyMarketplace(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  row: RepositoryRow,
  loaded: LoadedRepository,
  counts: EnrichmentCounts,
  removedIds: Set<number>,
  now: () => string,
): Promise<MarketplaceState | null> {
  const parserVersionChanged = row.marketplace_parser_version !== MARKETPLACE_PARSER_VERSION
  const result =
    row.marketplace_etag && !parserVersionChanged
      ? await reader.getMarketplace(loaded.owner, loaded.repo, row.marketplace_etag)
      : await reader.getMarketplace(loaded.owner, loaded.repo)
  if (result.kind === 'not-found') {
    removeLoadedRepository(db, runId, row, loaded, counts, removedIds)
    return null
  }
  if (result.kind === 'temporary-error') {
    recordProblem(db, runId, counts, row, temporaryCategory('marketplace', result), loaded.ready, false, now, result.retryCount)
    return null
  }
  const pluginsCount = result.kind === 'not-modified' ? row.plugins_count : result.data.plugins.length
  if (pluginsCount === null) {
    recordProblem(db, runId, counts, row, 'marketplace_not_modified_without_data', loaded.ready, false, now)
    return null
  }
  return {
    pluginsCount,
    marketplaceOid: row.marketplace_oid,
    marketplaceEtag: result.etag ?? row.marketplace_etag,
    parserVersion: MARKETPLACE_PARSER_VERSION,
  }
}

function acceptGraphQLNotModified(
  db: Database.Database,
  runId: string,
  row: RepositoryRow,
  loaded: LoadedRepository,
  changedOid: boolean,
  counts: EnrichmentCounts,
  now: () => string,
): row is RepositoryRow & { plugins_count: number } {
  if (changedOid) {
    recordProblem(db, runId, counts, row, 'marketplace_not_modified_after_oid_change', loaded.ready, true, now)
    return false
  }
  if (row.plugins_count === null) {
    recordProblem(db, runId, counts, row, 'marketplace_not_modified_without_data', loaded.ready, false, now)
    return false
  }
  return true
}

function parseGraphQLMarketplace(
  row: RepositoryRow,
  currentMarketplaceOid: string,
  blob: GitHubGraphQLMarketplace | null,
): MarketplaceState | undefined {
  if (
    blob === null ||
    blob.oid !== currentMarketplaceOid ||
    blob.isBinary !== false ||
    blob.isTruncated ||
    blob.text === null
  ) {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(blob.text)
    return {
      pluginsCount: parseMarketplaceManifest(parsed).plugins.length,
      marketplaceOid: currentMarketplaceOid,
      marketplaceEtag: row.marketplace_etag,
      parserVersion: MARKETPLACE_PARSER_VERSION,
    }
  } catch {
    return undefined
  }
}

async function loadGraphQLMarketplace(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  row: RepositoryRow,
  loaded: LoadedRepository,
  currentMarketplaceOid: string,
  counts: EnrichmentCounts,
  removedIds: Set<number>,
  now: () => string,
  prefetched?: GitHubGraphQLMarketplace | null,
): Promise<MarketplaceState | null> {
  const parserVersionChanged = row.marketplace_parser_version !== MARKETPLACE_PARSER_VERSION
  if (row.marketplace_oid === currentMarketplaceOid && row.plugins_count !== null && !parserVersionChanged) {
    return {
      pluginsCount: row.plugins_count,
      marketplaceOid: currentMarketplaceOid,
      marketplaceEtag: row.marketplace_etag,
      parserVersion: MARKETPLACE_PARSER_VERSION,
    }
  }

  if (prefetched !== undefined) {
    const parsed = parseGraphQLMarketplace(row, currentMarketplaceOid, prefetched)
    if (parsed) return parsed
  }

  const changedOid = row.marketplace_oid !== currentMarketplaceOid
  const result =
    row.marketplace_etag && !changedOid && row.plugins_count !== null && !parserVersionChanged
      ? await reader.getMarketplace(loaded.owner, loaded.repo, row.marketplace_etag)
      : await reader.getMarketplace(loaded.owner, loaded.repo)
  if (result.kind === 'not-found') {
    removeLoadedRepository(db, runId, row, loaded, counts, removedIds)
    return null
  }
  if (result.kind === 'temporary-error') {
    recordProblem(db, runId, counts, row, temporaryCategory('marketplace', result), loaded.ready, false, now, result.retryCount)
    return null
  }

  const marketplaceEtag = result.etag ?? row.marketplace_etag
  if (result.kind === 'not-modified') {
    if (!acceptGraphQLNotModified(db, runId, row, loaded, changedOid, counts, now)) return null
    return {
      pluginsCount: row.plugins_count,
      marketplaceOid: currentMarketplaceOid,
      marketplaceEtag,
      parserVersion: MARKETPLACE_PARSER_VERSION,
    }
  }
  return {
    pluginsCount: result.data.plugins.length,
    marketplaceOid: currentMarketplaceOid,
    marketplaceEtag,
    parserVersion: MARKETPLACE_PARSER_VERSION,
  }
}

function loadCachedRepository(
  row: RepositoryRow,
  identity: NonNullable<ReturnType<typeof parseRepositoryUrl>>,
  previouslyReady: boolean,
): LoadedRepository | null {
  if (
    !previouslyReady ||
    row.html_url === null ||
    row.stargazers_count === null ||
    row.forks_count === null ||
    row.subscribers_count === null ||
    row.owner === null ||
    row.owner_url === null ||
    row.repo_name === null ||
    row.repo_updated === null
  ) {
    return null
  }
  const ownerUrl = `https://github.com/${identity.owner}`
  const data: GitHubRepo = {
    html_url: row.html_url,
    name: row.repo_name,
    description: row.description,
    stargazers_count: row.stargazers_count,
    forks_count: row.forks_count,
    subscribers_count: row.subscribers_count,
    pushed_at: row.repo_updated,
    private: false,
    owner: { login: row.owner, html_url: row.owner_url },
    ...(row.github_node_id === null ? {} : { node_id: row.github_node_id }),
  }
  return {
    data,
    canonical: { htmlUrl: row.html_url, owner: identity.owner, ownerUrl, repo: identity.repo },
    moved: false,
    ready: true,
    owner: identity.owner,
    repo: identity.repo,
    ownerUrl,
    githubNodeId: row.github_node_id,
    marketplaceOid: row.marketplace_oid,
    repositoryEtag: row.repository_etag,
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
    const cached = loadCachedRepository(row, identity, previouslyReady)
    if (cached) return cached
    recordProblem(db, runId, counts, row, 'repository_not_modified_without_data', previouslyReady, false, now)
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
  const marketplace = await loadLegacyMarketplace(db, reader, runId, row, loaded, counts, removedIds, now)
  if (!marketplace) return
  const target = persistEnrichment(
    db,
    runId,
    row,
    loaded,
    marketplace.pluginsCount,
    marketplace.marketplaceOid,
    marketplace.marketplaceEtag,
    marketplace.parserVersion,
    now(),
  )
  completeEnrichment(counts, target, removedIds)
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
    githubNodeId: row.github_node_id,
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
  onProgress?: () => void,
  marketplaceBlob?: GitHubGraphQLMarketplace | null,
): Promise<void> {
  if (removedIds.has(row.id)) return
  if (data === null) {
    await enrichOne(db, reader, runId, row, counts, removedIds, now, onProgress)
    return
  }
  if (data.private) {
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
  onProgress?.()
  const marketplace = loaded.marketplaceOid
    ? await loadGraphQLMarketplace(
        db,
        reader,
        runId,
        row,
        loaded,
        loaded.marketplaceOid,
        counts,
        removedIds,
        now,
        marketplaceBlob,
      )
    : await loadLegacyMarketplace(db, reader, runId, row, loaded, counts, removedIds, now)
  if (!marketplace) return
  const target = persistEnrichment(
    db,
    runId,
    row,
    loaded,
    marketplace.pluginsCount,
    marketplace.marketplaceOid,
    marketplace.marketplaceEtag,
    marketplace.parserVersion,
    now(),
  )
  completeEnrichment(counts, target, removedIds)
}

type GraphQLBatchState = { size: number; stableBatches: number }
type GraphQLMarketplaceBatchState = { size: number; stableBatches: number }

const MARKETPLACE_BATCH_INITIAL = 20
const MARKETPLACE_BATCH_MAX = 50
const MARKETPLACE_BATCH_MAX_BYTES = 750_000
const MARKETPLACE_UNKNOWN_BYTES = 32_768

function needsMarketplaceContent(row: RepositoryRow, data: GitHubGraphQLRepo): boolean {
  if (data.marketplace_oid === null) return false
  return (
    row.marketplace_oid !== data.marketplace_oid ||
    row.plugins_count === null ||
    row.marketplace_parser_version !== MARKETPLACE_PARSER_VERSION
  )
}

function canFetchMarketplaceByGraphQL(data: GitHubGraphQLRepo): boolean {
  return data.marketplace_is_binary === false && (data.marketplace_byte_size ?? MARKETPLACE_UNKNOWN_BYTES) <= MARKETPLACE_BATCH_MAX_BYTES
}

function marketplaceEstimatedBytes(data: GitHubGraphQLRepo): number {
  return data.marketplace_byte_size ?? MARKETPLACE_UNKNOWN_BYTES
}

function tuneMarketplaceBatch(state: GraphQLMarketplaceBatchState, rowCount: number, latency: number, cost: number): void {
  if (latency >= 8_000 || cost > 50) {
    state.stableBatches = 0
    state.size = rowCount > 20 ? 20 : 10
    return
  }
  state.stableBatches++
  if (state.stableBatches < 5) return
  state.stableBatches = 0
  state.size = state.size < 25 ? 25 : state.size < 40 ? 40 : MARKETPLACE_BATCH_MAX
}

async function enrichLegacyBatch(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  rows: RepositoryRow[],
  counts: EnrichmentCounts,
  removedIds: Set<number>,
  now: () => string,
  onProgress?: () => void,
): Promise<void> {
  for (const row of rows) await enrichOne(db, reader, runId, row, counts, removedIds, now, onProgress)
}

async function recoverGraphQLBatch(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  rows: RepositoryRow[],
  counts: EnrichmentCounts,
  removedIds: Set<number>,
  state: GraphQLBatchState,
  now: () => string,
  onProgress?: () => void,
): Promise<void> {
  state.stableBatches = 0
  if (rows.length <= 10) {
    await enrichLegacyBatch(db, reader, runId, rows, counts, removedIds, now, onProgress)
    return
  }

  const smallerSize = rows.length > 25 ? 25 : 10
  state.size = smallerSize
  for (let offset = 0; offset < rows.length; offset += smallerSize) {
    await enrichGraphQLBatch(db, reader, runId, rows.slice(offset, offset + smallerSize), counts, removedIds, state, now, onProgress)
  }
}

function tuneGraphQLBatch(state: GraphQLBatchState, rowCount: number, latency: number, cost: number): void {
  if (latency >= 8_000 || cost > 50) {
    state.stableBatches = 0
    state.size = rowCount > 25 ? 25 : 10
    return
  }
  state.stableBatches++
  if (state.stableBatches >= 5) state.size = 50
}

async function enrichGraphQLMarketplaceCandidates(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  candidates: Array<{ row: RepositoryRow; data: GitHubGraphQLRepo }>,
  counts: EnrichmentCounts,
  removedIds: Set<number>,
  state: GraphQLMarketplaceBatchState,
  now: () => string,
  onProgress?: () => void,
): Promise<void> {
  const getBatch = reader.getMarketplacesByNodeId
  if (!getBatch) {
    for (const { row, data } of candidates) {
      await enrichGraphQLOne(db, reader, runId, row, data, counts, removedIds, now, onProgress)
    }
    return
  }

  let offset = 0
  while (offset < candidates.length) {
    const batch: Array<{ row: RepositoryRow; data: GitHubGraphQLRepo }> = []
    let estimatedBytes = 0
    while (offset < candidates.length && batch.length < state.size) {
      const candidate = candidates[offset]
      if (!candidate) break
      const bytes = marketplaceEstimatedBytes(candidate.data)
      if (batch.length > 0 && estimatedBytes + bytes > MARKETPLACE_BATCH_MAX_BYTES) break
      batch.push(candidate)
      estimatedBytes += bytes
      offset++
    }
    if (batch.length === 0) {
      const candidate = candidates[offset]
      if (!candidate) break
      batch.push(candidate)
      offset++
    }

    onProgress?.()
    const startedAt = Date.now()
    const result = await getBatch.call(
      reader,
      batch.map(({ row }) => row.github_node_id as string),
    )
    const latency = Date.now() - startedAt
    if (result.kind === 'temporary-error') {
      state.stableBatches = 0
      state.size = Math.max(10, Math.min(20, state.size))
      for (const { row, data } of batch) {
        await enrichGraphQLOne(db, reader, runId, row, data, counts, removedIds, now, onProgress)
      }
      continue
    }

    tuneMarketplaceBatch(state, batch.length, latency, result.rateLimit.cost)
    for (const [index, { row, data }] of batch.entries()) {
      await enrichGraphQLOne(
        db,
        reader,
        runId,
        row,
        data,
        counts,
        removedIds,
        now,
        onProgress,
        result.data[index] ?? null,
      )
    }
  }
}

async function enrichGraphQLBatch(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  rows: RepositoryRow[],
  counts: EnrichmentCounts,
  removedIds: Set<number>,
  state: GraphQLBatchState,
  marketplaceState: GraphQLMarketplaceBatchState,
  now: () => string,
  onProgress?: () => void,
): Promise<void> {
  const getBatch = reader.getRepositoriesByNodeId
  if (!getBatch) return enrichLegacyBatch(db, reader, runId, rows, counts, removedIds, now, onProgress)

  const ids = rows.map((row) => row.github_node_id as string)
  onProgress?.()
  const startedAt = Date.now()
  const result = await getBatch.call(reader, ids)
  const latency = Date.now() - startedAt
  if (result.kind === 'temporary-error') {
    await recoverGraphQLBatch(db, reader, runId, rows, counts, removedIds, state, now, onProgress)
    return
  }

  tuneGraphQLBatch(state, rows.length, latency, result.rateLimit.cost)
  const marketplaceCandidates: Array<{ row: RepositoryRow; data: GitHubGraphQLRepo }> = []
  for (const [index, row] of rows.entries()) {
    const data = result.data[index] ?? null
    if (
      data !== null &&
      reader.getMarketplacesByNodeId &&
      needsMarketplaceContent(row, data) &&
      canFetchMarketplaceByGraphQL(data)
    ) {
      marketplaceCandidates.push({ row, data })
      continue
    }
    await enrichGraphQLOne(db, reader, runId, row, data, counts, removedIds, now, onProgress)
  }
  await enrichGraphQLMarketplaceCandidates(
    db,
    reader,
    runId,
    marketplaceCandidates,
    counts,
    removedIds,
    marketplaceState,
    now,
    onProgress,
  )
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
  const marketplaceBatchState = { size: MARKETPLACE_BATCH_INITIAL, stableBatches: 0 }
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
      await enrichGraphQLBatch(db, reader, runId, batch, counts, removedIds, batchState, marketplaceBatchState, now, onProgress)
    }
    onProgress?.()
  }
  return counts
}
