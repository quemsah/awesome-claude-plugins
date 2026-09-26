import { parseMarketplaceManifest } from '@awesome-claude-plugins/marketplace-contract'
import type Database from 'better-sqlite3'
import type { GitHubGraphQLMarketplaceBlob } from '../github/client.js'
import { GitHubFatalError, type GitHubGraphQLRepo, type GitHubReader, type GitHubRepo, type RepoResult } from '../github/client.js'
import { isValidGitHubPathSegment, parseGitHubOwnerUrl } from '../github/identifiers.js'
import { parseRepositoryUrl } from '../github/repositoryUrl.js'
import type { Log } from '../logging.js'
import {
  deleteById,
  deleteCanonicalRows,
  getRepositoryById,
  listForEnrichment,
  type RepositoryRow,
  rebindCanonicalUrl,
  updateEnriched,
} from '../storage/repositories.js'
import { advanceRunPhase, getRun, recordRunError, runWhileActive, startRunPhase } from '../storage/runs.js'

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
  log?: Log,
  details: Record<string, unknown> = {},
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
  const identity = parseRepositoryUrl(row.html_url ?? '')
  const repository = identity ? `${identity.owner}/${identity.repo}` : [row.owner, row.repo_name].filter(Boolean).join('/') || null
  const request = errorType.startsWith('marketplace_')
    ? `GET /repos/${repository ?? '<unknown>'}/contents/.claude-plugin/marketplace.json`
    : `GET /repos/${repository ?? '<unknown>'}`
  log?.({
    level: 'warn',
    event: 'crawl.repository_warning',
    phase: 'enrichment',
    category: errorType,
    runId,
    message: `${errorType} for ${repository ?? `repository id ${row.id}`}`,
    repository,
    repositoryId: row.id,
    repositoryUrl: row.html_url,
    request,
    retryCount,
    outcome: previouslyReady ? 'kept_previous_data' : 'left_incomplete',
    ...details,
  })
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
  clearMarketplaceEtag = false,
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
    if (clearMarketplaceEtag) {
      db.prepare('UPDATE repositories SET marketplace_etag = NULL WHERE id = ?').run(rebound.id)
    }
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
  log?: Log,
): void {
  const removedId = runWhileActive(db, runId, () => {
    if (loaded.moved) return deleteCanonicalRows(db, row.id, loaded.canonical.htmlUrl)
    deleteById(db, row.id)
    return null
  })
  if (removedId !== null) removedIds.add(removedId)
  counts.deleted404++
  counts.conclusive++
  log?.({
    level: 'warn',
    event: 'crawl.repository_removed',
    phase: 'enrichment',
    category: 'marketplace_not_found',
    runId,
    message: `Marketplace manifest not found for ${loaded.owner}/${loaded.repo}; removing repository`,
    repository: `${loaded.owner}/${loaded.repo}`,
    repositoryId: row.id,
    repositoryUrl: row.html_url,
    request: `GET /repos/${loaded.owner}/${loaded.repo}/contents/.claude-plugin/marketplace.json`,
    status: 404,
    outcome: 'repository_removed',
  })
}

function completeEnrichment(counts: EnrichmentCounts, target: EnrichmentTarget, removedIds: Set<number>): void {
  if (target.removedId !== null) removedIds.add(target.removedId)
  counts.conclusive++
  if (target.ready) counts.updated++
  else counts.newReady++
}

const MARKETPLACE_PARSER_VERSION = 1
const MARKETPLACE_CONTENT_BATCH_SIZE = 25
const MARKETPLACE_CONTENT_MAX_BYTES = 750_000
const MARKETPLACE_UNKNOWN_BYTES = 32_768

type MarketplaceState = {
  pluginsCount: number
  marketplaceOid: string | null
  marketplaceEtag: string | null
  clearMarketplaceEtag?: boolean
  parserVersion: number
}

function needsMarketplaceContent(row: RepositoryRow, currentMarketplaceOid: string): boolean {
  return (
    row.marketplace_oid !== currentMarketplaceOid ||
    row.plugins_count === null ||
    row.marketplace_parser_version !== MARKETPLACE_PARSER_VERSION
  )
}

function decodeGraphQLMarketplaceBlob(blob: GitHubGraphQLMarketplaceBlob): { pluginsCount: number; marketplaceOid: string } | null {
  if (blob.is_truncated || blob.is_binary !== false || blob.text === null) return null
  try {
    const marketplace = parseMarketplaceManifest(JSON.parse(blob.text))
    return { pluginsCount: marketplace.plugins.length, marketplaceOid: blob.oid }
  } catch {
    return null
  }
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
  log?: Log,
): Promise<MarketplaceState | null> {
  const parserVersionChanged = row.marketplace_parser_version !== MARKETPLACE_PARSER_VERSION
  let result: RepoResult<{ plugins: unknown[] }>
  try {
    result =
      row.marketplace_etag && !parserVersionChanged
        ? await reader.getMarketplace(loaded.owner, loaded.repo, row.marketplace_etag)
        : await reader.getMarketplace(loaded.owner, loaded.repo)
  } catch (error) {
    if (error instanceof GitHubFatalError) {
      log?.({
        level: 'error',
        event: 'crawl.request_failed',
        phase: 'enrichment',
        category: 'github_fatal_error',
        runId,
        message: `Marketplace request failed for ${loaded.owner}/${loaded.repo}`,
        repository: `${loaded.owner}/${loaded.repo}`,
        repositoryId: row.id,
        repositoryUrl: row.html_url,
        request: `GET /repos/${loaded.owner}/${loaded.repo}/contents/.claude-plugin/marketplace.json`,
        status: error.status,
        reason: error.message,
      })
    }
    throw error
  }
  if (result.kind === 'not-found') {
    removeLoadedRepository(db, runId, row, loaded, counts, removedIds, log)
    return null
  }
  if (result.kind === 'temporary-error') {
    recordProblem(db, runId, counts, row, temporaryCategory('marketplace', result), loaded.ready, false, now, result.retryCount, log, {
      request: `GET /repos/${loaded.owner}/${loaded.repo}/contents/.claude-plugin/marketplace.json`,
      status: result.status,
      reason: result.reason,
    })
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
  log?: Log,
): row is RepositoryRow & { plugins_count: number } {
  if (changedOid) {
    recordProblem(db, runId, counts, row, 'marketplace_not_modified_after_oid_change', loaded.ready, true, now, 0, log, {
      request: `GET /repos/${loaded.owner}/${loaded.repo}/contents/.claude-plugin/marketplace.json`,
      oidChanged: true,
    })
    return false
  }
  if (row.plugins_count === null) {
    recordProblem(db, runId, counts, row, 'marketplace_not_modified_without_data', loaded.ready, false, now)
    return false
  }
  return true
}

async function loadGraphQLMarketplace(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  row: RepositoryRow,
  loaded: LoadedRepository,
  currentMarketplaceOid: string,
  blob: GitHubGraphQLMarketplaceBlob | null,
  counts: EnrichmentCounts,
  removedIds: Set<number>,
  now: () => string,
  log?: Log,
): Promise<MarketplaceState | null> {
  const parserVersionChanged = row.marketplace_parser_version !== MARKETPLACE_PARSER_VERSION
  if (!needsMarketplaceContent(row, currentMarketplaceOid)) {
    return {
      pluginsCount: row.plugins_count as number,
      marketplaceOid: currentMarketplaceOid,
      marketplaceEtag: row.marketplace_etag,
      parserVersion: MARKETPLACE_PARSER_VERSION,
    }
  }

  if (blob) {
    const decoded = decodeGraphQLMarketplaceBlob(blob)
    if (decoded) {
      return {
        pluginsCount: decoded.pluginsCount,
        marketplaceOid: decoded.marketplaceOid,
        marketplaceEtag: null,
        clearMarketplaceEtag: true,
        parserVersion: MARKETPLACE_PARSER_VERSION,
      }
    }
  }

  const authoritativeMarketplaceOid = blob?.oid ?? currentMarketplaceOid
  const changedOid = row.marketplace_oid !== authoritativeMarketplaceOid
  let result: RepoResult<{ plugins: unknown[] }>
  try {
    result =
      row.marketplace_etag && !changedOid && row.plugins_count !== null && !parserVersionChanged
        ? await reader.getMarketplace(loaded.owner, loaded.repo, row.marketplace_etag)
        : await reader.getMarketplace(loaded.owner, loaded.repo)
  } catch (error) {
    if (error instanceof GitHubFatalError) {
      log?.({
        level: 'error',
        event: 'crawl.request_failed',
        phase: 'enrichment',
        category: 'github_fatal_error',
        runId,
        message: `Marketplace request failed for ${loaded.owner}/${loaded.repo}`,
        repository: `${loaded.owner}/${loaded.repo}`,
        repositoryId: row.id,
        repositoryUrl: row.html_url,
        request: `GET /repos/${loaded.owner}/${loaded.repo}/contents/.claude-plugin/marketplace.json`,
        status: error.status,
        reason: error.message,
        marketplaceOid: authoritativeMarketplaceOid,
      })
    }
    throw error
  }
  if (result.kind === 'not-found') {
    removeLoadedRepository(db, runId, row, loaded, counts, removedIds, log)
    return null
  }
  if (result.kind === 'temporary-error') {
    recordProblem(db, runId, counts, row, temporaryCategory('marketplace', result), loaded.ready, false, now, result.retryCount, log, {
      request: `GET /repos/${loaded.owner}/${loaded.repo}/contents/.claude-plugin/marketplace.json`,
      status: result.status,
      reason: result.reason,
      marketplaceOid: currentMarketplaceOid,
    })
    return null
  }

  const marketplaceEtag = result.etag ?? row.marketplace_etag
  if (result.kind === 'not-modified') {
    if (!acceptGraphQLNotModified(db, runId, row, loaded, changedOid, counts, now, log)) return null
    return {
      pluginsCount: row.plugins_count,
      marketplaceOid: authoritativeMarketplaceOid,
      marketplaceEtag,
      parserVersion: MARKETPLACE_PARSER_VERSION,
    }
  }
  return {
    pluginsCount: result.data.plugins.length,
    marketplaceOid: null,
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

function logRepositoryFatalError(
  error: GitHubFatalError,
  runId: string,
  row: RepositoryRow,
  identity: NonNullable<ReturnType<typeof parseRepositoryUrl>>,
  log?: Log,
): void {
  log?.({
    level: 'error',
    event: 'crawl.request_failed',
    phase: 'enrichment',
    category: 'github_fatal_error',
    runId,
    message: `Repository metadata request failed for ${identity.owner}/${identity.repo}`,
    repository: `${identity.owner}/${identity.repo}`,
    repositoryId: row.id,
    repositoryUrl: row.html_url,
    request: `GET /repos/${identity.owner}/${identity.repo}`,
    status: error.status,
    reason: error.message,
  })
}

function removeMissingRepository(
  db: Database.Database,
  runId: string,
  row: RepositoryRow,
  identity: NonNullable<ReturnType<typeof parseRepositoryUrl>>,
  counts: EnrichmentCounts,
  log?: Log,
): null {
  log?.({
    level: 'warn',
    event: 'crawl.repository_removed',
    phase: 'enrichment',
    category: 'repository_not_found',
    runId,
    message: `GitHub repository not found: ${identity.owner}/${identity.repo}; removing repository`,
    repository: `${identity.owner}/${identity.repo}`,
    repositoryId: row.id,
    repositoryUrl: row.html_url,
    request: `GET /repos/${identity.owner}/${identity.repo}`,
    status: 404,
    outcome: 'repository_removed',
  })
  runWhileActive(db, runId, () => deleteById(db, row.id))
  counts.deleted404++
  counts.conclusive++
  return null
}

function buildLoadedRepository(
  db: Database.Database,
  row: RepositoryRow,
  identity: NonNullable<ReturnType<typeof parseRepositoryUrl>>,
  previouslyReady: boolean,
  result: Extract<RepoResult<GitHubRepo>, { kind: 'found' }>,
): LoadedRepository | null {
  const canonical = canonicalIdentity(result.data)
  if (!canonical) return null
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

async function loadRepository(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  row: RepositoryRow,
  identity: NonNullable<ReturnType<typeof parseRepositoryUrl>>,
  previouslyReady: boolean,
  counts: EnrichmentCounts,
  now: () => string,
  log?: Log,
): Promise<LoadedRepository | null> {
  let result: RepoResult<GitHubRepo>
  try {
    result = row.repository_etag
      ? await reader.getRepository(identity.owner, identity.repo, row.repository_etag)
      : await reader.getRepository(identity.owner, identity.repo)
  } catch (error) {
    if (error instanceof GitHubFatalError) logRepositoryFatalError(error, runId, row, identity, log)
    throw error
  }
  if (result.kind === 'not-found') return removeMissingRepository(db, runId, row, identity, counts, log)
  if (result.kind === 'temporary-error') {
    recordProblem(db, runId, counts, row, temporaryCategory('repository', result), previouslyReady, false, now, result.retryCount, log, {
      request: `GET /repos/${identity.owner}/${identity.repo}`,
      status: result.status,
      reason: result.reason,
    })
    return null
  }
  if (result.kind === 'not-modified') {
    const cached = loadCachedRepository(row, identity, previouslyReady)
    if (cached) return cached
    recordProblem(db, runId, counts, row, 'repository_not_modified_without_data', previouslyReady, false, now)
    return null
  }
  const loaded = buildLoadedRepository(db, row, identity, previouslyReady, result)
  if (!loaded) recordProblem(db, runId, counts, row, 'repository_identity_mismatch', previouslyReady, true, now)
  return loaded
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
  log?: Log,
): Promise<void> {
  if (!row.html_url?.trim()) {
    if (row.owner && row.repo_name) {
      log?.({
        level: 'warn',
        event: 'crawl.repository_removed',
        phase: 'enrichment',
        category: 'repository_blank_url',
        runId,
        message: `Removing repository with an empty URL: ${row.owner}/${row.repo_name}`,
        repository: `${row.owner}/${row.repo_name}`,
        repositoryId: row.id,
        outcome: 'repository_removed',
      })
    }
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
  const loaded = await loadRepository(db, reader, runId, row, identity, previouslyReady, counts, now, log)
  if (!loaded) return
  onProgress?.()
  const marketplace = await loadLegacyMarketplace(db, reader, runId, row, loaded, counts, removedIds, now, log)
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
  marketplaceBlob: GitHubGraphQLMarketplaceBlob | null,
  counts: EnrichmentCounts,
  removedIds: Set<number>,
  now: () => string,
  onProgress?: () => void,
  log?: Log,
): Promise<void> {
  if (removedIds.has(row.id)) return
  if (data === null) {
    await enrichOne(db, reader, runId, row, counts, removedIds, now, onProgress, log)
    return
  }
  if (data.private) {
    const identity = parseRepositoryUrl(row.html_url ?? '')
    log?.({
      level: 'warn',
      event: 'crawl.repository_removed',
      phase: 'enrichment',
      category: 'repository_private',
      runId,
      message: `Repository is private: ${identity ? `${identity.owner}/${identity.repo}` : `id ${row.id}`}; removing it`,
      repository: identity ? `${identity.owner}/${identity.repo}` : null,
      repositoryId: row.id,
      repositoryUrl: row.html_url,
      request: 'POST /graphql',
      outcome: 'repository_removed',
    })
    runWhileActive(db, runId, () => deleteById(db, row.id))
    counts.deleted404++
    counts.conclusive++
    return
  }
  const loaded = loadGraphQLRepository(db, row, data)
  if (!loaded) {
    recordProblem(db, runId, counts, row, 'repository_identity_mismatch', wasReady(row), true, now, 0, log, {
      request: 'POST /graphql',
    })
    return
  }
  onProgress?.()
  const marketplace = loaded.marketplaceOid
    ? await loadGraphQLMarketplace(db, reader, runId, row, loaded, loaded.marketplaceOid, marketplaceBlob, counts, removedIds, now, log)
    : await loadLegacyMarketplace(db, reader, runId, row, loaded, counts, removedIds, now, log)
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
    marketplace.clearMarketplaceEtag ?? false,
  )
  completeEnrichment(counts, target, removedIds)
}

type GraphQLBatchState = { size: number; stableBatches: number }

async function enrichLegacyBatch(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  rows: RepositoryRow[],
  counts: EnrichmentCounts,
  removedIds: Set<number>,
  now: () => string,
  onProgress?: () => void,
  log?: Log,
): Promise<void> {
  for (const row of rows) await enrichOne(db, reader, runId, row, counts, removedIds, now, onProgress, log)
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
  log?: Log,
): Promise<void> {
  state.stableBatches = 0
  if (rows.length <= 10) {
    await enrichLegacyBatch(db, reader, runId, rows, counts, removedIds, now, onProgress, log)
    return
  }

  const smallerSize = rows.length > 25 ? 25 : 10
  state.size = smallerSize
  for (let offset = 0; offset < rows.length; offset += smallerSize) {
    await enrichGraphQLBatch(db, reader, runId, rows.slice(offset, offset + smallerSize), counts, removedIds, state, now, onProgress, log)
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

function marketplaceEstimatedBytes(repository: GitHubGraphQLRepo): number {
  return repository.marketplace_byte_size ?? MARKETPLACE_UNKNOWN_BYTES
}

function canFetchMarketplaceByGraphQL(repository: GitHubGraphQLRepo): boolean {
  return repository.marketplace_is_binary === false && marketplaceEstimatedBytes(repository) <= MARKETPLACE_CONTENT_MAX_BYTES
}

async function loadGraphQLMarketplaceBlobs(
  runId: string,
  reader: GitHubReader,
  rows: RepositoryRow[],
  repositories: Array<GitHubGraphQLRepo | null>,
  onProgress?: () => void,
  log?: Log,
): Promise<Map<string, GitHubGraphQLMarketplaceBlob>> {
  const getBlobs = reader.getMarketplaceBlobsByNodeId
  const blobs = new Map<string, GitHubGraphQLMarketplaceBlob>()
  if (!getBlobs) return blobs

  const candidates: Array<{ nodeId: string; estimatedBytes: number }> = []
  const seen = new Set<string>()
  for (const [index, row] of rows.entries()) {
    const repository = repositories[index] ?? null
    const nodeId = row.github_node_id
    if (
      !nodeId ||
      seen.has(nodeId) ||
      !repository ||
      repository.private ||
      repository.marketplace_oid === null ||
      canonicalIdentity(repository) === null ||
      !needsMarketplaceContent(row, repository.marketplace_oid) ||
      !canFetchMarketplaceByGraphQL(repository)
    ) {
      continue
    }
    seen.add(nodeId)
    candidates.push({ nodeId, estimatedBytes: marketplaceEstimatedBytes(repository) })
  }

  const fetchBatch = async (batch: Array<{ nodeId: string; estimatedBytes: number }>): Promise<void> => {
    if (batch.length === 0) return
    onProgress?.()
    let result: Awaited<ReturnType<typeof getBlobs>>
    try {
      result = await getBlobs.call(
        reader,
        batch.map(({ nodeId }) => nodeId),
      )
    } catch (error) {
      if (error instanceof GitHubFatalError) {
        log?.({
          level: 'error',
          event: 'crawl.request_failed',
          phase: 'enrichment',
          category: 'github_fatal_error',
          runId,
          message: `GraphQL marketplace content request failed for ${batch.length} repositories`,
          request: 'POST /graphql',
          status: error.status,
          reason: error.message,
          batchSize: batch.length,
          repositoryUrls: rows
            .filter((row) => batch.some((candidate) => candidate.nodeId === row.github_node_id))
            .map((row) => row.html_url)
            .filter((url): url is string => Boolean(url)),
        })
      }
      throw error
    }
    if (result.kind === 'temporary-error') {
      const canSplit = batch.length > 1 && /timeout|invalid graphql response/i.test(result.reason)
      log?.({
        level: 'warn',
        event: 'crawl.graphql_marketplace_batch_fallback',
        phase: 'enrichment',
        category: 'graphql_marketplace_temporary_error',
        runId,
        message: canSplit
          ? `GraphQL marketplace content batch failed; splitting ${batch.length} repositories`
          : `GraphQL marketplace content unavailable; falling back to REST for ${batch.length} repositories`,
        request: 'POST /graphql',
        status: result.status,
        reason: result.reason,
        batchSize: batch.length,
        repositoryUrls: rows
          .filter((row) => batch.some((candidate) => candidate.nodeId === row.github_node_id))
          .map((row) => row.html_url)
          .filter((url): url is string => Boolean(url)),
        fallback: canSplit ? 'split' : 'REST',
      })
      if (canSplit) {
        const midpoint = Math.ceil(batch.length / 2)
        await fetchBatch(batch.slice(0, midpoint))
        await fetchBatch(batch.slice(midpoint))
      }
      return
    }

    for (const [index, candidate] of batch.entries()) {
      const blob = result.data[index] ?? null
      // GitHub may return a migrated global node ID when X-Github-Next-Global-ID is enabled.
      // nodes(ids:) preserves positional alignment, so correlate by the requested ID.
      if (blob) blobs.set(candidate.nodeId, blob)
    }
  }

  let offset = 0
  while (offset < candidates.length) {
    const batch: Array<{ nodeId: string; estimatedBytes: number }> = []
    let estimatedBytes = 0
    while (offset < candidates.length && batch.length < MARKETPLACE_CONTENT_BATCH_SIZE) {
      const candidate = candidates[offset]
      if (!candidate) break
      if (batch.length > 0 && estimatedBytes + candidate.estimatedBytes > MARKETPLACE_CONTENT_MAX_BYTES) break
      batch.push(candidate)
      estimatedBytes += candidate.estimatedBytes
      offset++
    }
    if (batch.length === 0) {
      const candidate = candidates[offset]
      if (!candidate) break
      batch.push(candidate)
      offset++
    }
    await fetchBatch(batch)
  }

  return blobs
}

async function enrichGraphQLBatch(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  rows: RepositoryRow[],
  counts: EnrichmentCounts,
  removedIds: Set<number>,
  state: GraphQLBatchState,
  now: () => string,
  onProgress?: () => void,
  log?: Log,
): Promise<void> {
  const getBatch = reader.getRepositoriesByNodeId
  if (!getBatch) return enrichLegacyBatch(db, reader, runId, rows, counts, removedIds, now, onProgress, log)

  const ids = rows.map((row) => row.github_node_id as string)
  onProgress?.()
  const startedAt = Date.now()
  let result: Awaited<ReturnType<typeof getBatch>>
  try {
    result = await getBatch.call(reader, ids)
  } catch (error) {
    if (error instanceof GitHubFatalError) {
      log?.({
        level: 'error',
        event: 'crawl.request_failed',
        phase: 'enrichment',
        category: 'github_fatal_error',
        runId,
        message: `GraphQL batch failed for ${rows.length} repositories`,
        request: 'POST /graphql',
        status: error.status,
        reason: error.message,
        batchSize: rows.length,
        repositoryUrls: rows.map((row) => row.html_url).filter((url): url is string => Boolean(url)),
      })
    }
    throw error
  }
  const latency = Date.now() - startedAt
  if (result.kind === 'temporary-error') {
    log?.({
      level: 'warn',
      event: 'crawl.graphql_batch_fallback',
      phase: 'enrichment',
      category: 'graphql_temporary_error',
      runId,
      message: `GraphQL batch failed; retrying ${rows.length} repositories via REST`,
      request: 'POST /graphql',
      status: result.status,
      reason: result.reason,
      batchSize: rows.length,
      repositoryUrls: rows.map((row) => row.html_url).filter((url): url is string => Boolean(url)),
      fallback: 'REST',
    })
    await recoverGraphQLBatch(db, reader, runId, rows, counts, removedIds, state, now, onProgress, log)
    return
  }

  tuneGraphQLBatch(state, rows.length, latency, result.rateLimit.cost)
  const marketplaceBlobs = await loadGraphQLMarketplaceBlobs(runId, reader, rows, result.data, onProgress, log)
  for (const [index, row] of rows.entries()) {
    const marketplaceBlob = row.github_node_id ? (marketplaceBlobs.get(row.github_node_id) ?? null) : null
    await enrichGraphQLOne(db, reader, runId, row, result.data[index] ?? null, marketplaceBlob, counts, removedIds, now, onProgress, log)
  }
}

export async function enrichRepositories(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  onProgress?: () => void,
  now: () => string = () => new Date().toISOString(),
  log?: Log,
): Promise<EnrichmentCounts> {
  if (getRun(db, runId)?.phase !== 'enrichment') {
    const total = (db.prepare('SELECT COUNT(*) AS count FROM repositories').get() as { count: number }).count
    startRunPhase(db, runId, 'enrichment', now(), total)
  }
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
    const removedBefore = new Set(removedIds)
    const graphQLRows = rows.filter((row) => row.github_node_id && parseRepositoryUrl(row.html_url ?? ''))
    const legacyRows = rows.filter((row) => !row.github_node_id || !parseRepositoryUrl(row.html_url ?? ''))
    for (const row of legacyRows) {
      if (!removedIds.has(row.id)) await enrichOne(db, reader, runId, row, counts, removedIds, now, onProgress, log)
    }
    for (let offset = 0; offset < graphQLRows.length; ) {
      const batch = graphQLRows.slice(offset, offset + batchState.size)
      offset += batch.length
      await enrichGraphQLBatch(db, reader, runId, batch, counts, removedIds, batchState, now, onProgress, log)
    }
    const removedFutureRows = [...removedIds].filter((id) => !removedBefore.has(id) && id > lastId).length
    advanceRunPhase(db, runId, rows.length + removedFutureRows, now())
    onProgress?.()
  }
  return counts
}
