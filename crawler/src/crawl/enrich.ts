import {
  MARKETPLACE_CONTRACT_VERSION,
  MarketplaceValidationError,
  parseMarketplaceManifest,
} from '@awesome-claude-plugins/marketplace-contract'
import type Database from 'better-sqlite3'
import type { GitHubGraphQLMarketplaceBlob } from '../github/client.js'
import { GitHubFatalError, type GitHubGraphQLRepo, type GitHubReader, type GitHubRepo, type RepoResult } from '../github/client.js'
import { isValidGitHubPathSegment, parseGitHubOwnerUrl } from '../github/identifiers.js'
import type { GitHubRetryReason } from '../github/rateBudget.js'
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
  knownInvalidSkipped?: number
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
  if (result.failureReason === 'primary_rate_limit' || result.failureReason === 'secondary_rate_limit' || result.status === 429) {
    return `${endpoint}_rate_limited`
  }
  if (result.failureReason === 'invalid_response' || result.failureReason === 'body_read' || result.reason === 'Invalid GitHub response') {
    return `${endpoint}_invalid_response`
  }
  if (result.failureReason === 'parser_internal') return `${endpoint}_parser_internal`
  return `${endpoint}_temporary_error`
}

function invalidContentCategory(failure: 'invalid-json' | 'invalid-manifest'): string {
  return failure === 'invalid-json' ? 'marketplace_invalid_json' : 'marketplace_invalid_manifest'
}

function marketplaceValidationReason(error: MarketplaceValidationError): string {
  const issue = error.issues[0]
  const path = issue?.path.reduce<string>(
    (prefix, part) => (typeof part === 'number' ? `${prefix}[${part}]` : prefix ? `${prefix}.${part}` : part),
    '',
  )
  return `Invalid marketplace manifest${path ? ` at ${path}` : ''}: ${issue?.message ?? error.message}`
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
    db.prepare('UPDATE repositories SET marketplace_failed_oid = NULL, marketplace_failed_parser_version = NULL WHERE id = ?').run(
      rebound.id,
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

const MARKETPLACE_PARSER_VERSION = MARKETPLACE_CONTRACT_VERSION
const MARKETPLACE_CONTENT_BATCH_SIZE = 25
const MARKETPLACE_CONTENT_MAX_BYTES = 750_000
const MARKETPLACE_UNKNOWN_BYTES = 32_768

const RETRY_LATER = Symbol('retry-later')
type RetryLater = { kind: typeof RETRY_LATER; reason: GitHubRetryReason; retryAt?: number }
type RestAttemptPolicy = {
  maxAttempts: number
  retryCountOffset: number
  deferTransient: boolean
}
type RetryTask = { row: RepositoryRow; run: () => Promise<void> }
type RetryQueue = { tasks: RetryTask[]; deferredIds: Set<number> }

function queueRetry(queue: RetryQueue | undefined, row: RepositoryRow, run: () => Promise<void>): void {
  if (!queue) return
  queue.deferredIds.add(row.id)
  queue.tasks.push({ row, run })
}

const FIRST_PASS_REST: RestAttemptPolicy = { maxAttempts: 1, retryCountOffset: 0, deferTransient: true }
const RETRY_PASS_REST: RestAttemptPolicy = { maxAttempts: 2, retryCountOffset: 1, deferTransient: false }

function totalRetryCount(result: { retryCount: number }, policy: RestAttemptPolicy): number {
  return result.retryCount + policy.retryCountOffset
}

function retryReason(result: Extract<RepoResult<unknown>, { kind: 'temporary-error' }>): GitHubRetryReason {
  if (result.failureReason) return result.failureReason
  if (result.status === null) return 'network'
  if (result.status >= 500) return 'server_5xx'
  if (result.status === 429) return 'secondary_rate_limit'
  if (result.reason === 'GitHub response body read failed') return 'body_read'
  if (result.reason === 'Marketplace parser failure') return 'parser_internal'
  return 'invalid_response'
}

function deferTransient(result: Extract<RepoResult<unknown>, { kind: 'temporary-error' }>, policy: RestAttemptPolicy): RetryLater | null {
  return policy.deferTransient && result.retryable === true
    ? { kind: RETRY_LATER, reason: retryReason(result), ...(result.retryAt === undefined ? {} : { retryAt: result.retryAt }) }
    : null
}

async function beginDeferredRetry(reader: GitHubReader, retry: RetryLater): Promise<void> {
  const waitMs = retry.retryAt === undefined ? 0 : ((await reader.waitUntil?.(retry.retryAt)) ?? 0)
  reader.noteRetry?.('core', retry.reason, waitMs)
}

function isRetryLater(value: unknown): value is RetryLater {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === RETRY_LATER
}

type MarketplaceState = {
  pluginsCount: number
  marketplaceOid: string | null
  marketplaceEtag: string | null
  clearMarketplaceEtag?: boolean
  parserVersion: number
}

function needsMarketplaceContent(row: RepositoryRow, currentMarketplaceOid: string): boolean {
  if (row.marketplace_failed_oid === currentMarketplaceOid && row.marketplace_failed_parser_version === MARKETPLACE_PARSER_VERSION) {
    return false
  }
  return (
    row.marketplace_oid !== currentMarketplaceOid ||
    row.plugins_count === null ||
    row.marketplace_parser_version !== MARKETPLACE_PARSER_VERSION
  )
}

type MarketplaceBlobDecode =
  | { kind: 'found'; pluginsCount: number; marketplaceOid: string }
  | { kind: 'unsupported' }
  | { kind: 'invalid-content'; failure: 'invalid-json' | 'invalid-manifest'; reason: string }

function decodeGraphQLMarketplaceBlob(blob: GitHubGraphQLMarketplaceBlob): MarketplaceBlobDecode {
  if (blob.is_truncated || blob.is_binary !== false || blob.text === null) return { kind: 'unsupported' }
  let value: unknown
  try {
    value = JSON.parse(blob.text) as unknown
  } catch {
    return { kind: 'invalid-content', failure: 'invalid-json', reason: 'Invalid marketplace JSON' }
  }
  try {
    const marketplace = parseMarketplaceManifest(value)
    return { kind: 'found', pluginsCount: marketplace.plugins.length, marketplaceOid: blob.oid }
  } catch (error) {
    if (!(error instanceof MarketplaceValidationError)) throw error
    return {
      kind: 'invalid-content',
      failure: 'invalid-manifest',
      reason: marketplaceValidationReason(error),
    }
  }
}

type InvalidMarketplaceIdentity = {
  cacheOid: string | null
  marketplaceOid: string | null
  contentOid: string | null
}

function marketplaceStateScore(row: RepositoryRow): number {
  let score = 0
  if (row.marketplace_parser_version === MARKETPLACE_PARSER_VERSION) score += 16
  else if (row.marketplace_parser_version !== null) score += 8
  if (row.marketplace_oid !== null) score += 4
  if (row.marketplace_etag !== null) score += 2
  if (row.plugins_count !== null) score += 1
  return score
}

function persistRepositoryMetadataOnMarketplaceError(
  db: Database.Database,
  runId: string,
  row: RepositoryRow,
  loaded: LoadedRepository,
  removedIds: Set<number>,
  at: string,
): EnrichmentTarget {
  return runWhileActive(db, runId, () => {
    const duplicate = loaded.moved
      ? (db
          .prepare('SELECT * FROM repositories WHERE html_url = ? COLLATE NOCASE AND id != ? ORDER BY id LIMIT 1')
          .get(loaded.canonical.htmlUrl, row.id) as RepositoryRow | undefined)
      : undefined
    const preserved = duplicate && marketplaceStateScore(duplicate) > marketplaceStateScore(row) ? duplicate : row
    const rebound = loaded.moved ? rebindCanonicalUrl(db, row.id, loaded.canonical.htmlUrl, at) : { id: row.id, removedId: null }
    if (!getRepositoryById(db, rebound.id)) throw new Error('Canonical repository disappeared during metadata update')
    if (!loaded.ready) {
      db.prepare(`
        UPDATE repositories SET
          owner = NULL,
          owner_url = NULL,
          repo_name = NULL,
          github_node_id = COALESCE(?, github_node_id),
          repository_etag = COALESCE(?, repository_etag),
          updatedAt = ?
        WHERE id = ?
      `).run(loaded.githubNodeId, loaded.repositoryEtag, at, rebound.id)
      if (rebound.removedId !== null) removedIds.add(rebound.removedId)
      return { id: rebound.id, removedId: rebound.removedId, ready: false }
    }
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
        plugins_count: preserved.plugins_count,
        github_node_id: loaded.githubNodeId,
        marketplace_oid: preserved.marketplace_oid,
        repository_etag: loaded.repositoryEtag,
        marketplace_etag: preserved.marketplace_etag,
        marketplace_parser_version: preserved.marketplace_parser_version,
      },
      at,
    )
    if (rebound.removedId !== null) removedIds.add(rebound.removedId)
    return { id: rebound.id, removedId: rebound.removedId, ready: loaded.ready }
  })
}

function recordInvalidMarketplace(
  db: Database.Database,
  runId: string,
  counts: EnrichmentCounts,
  row: RepositoryRow,
  loaded: LoadedRepository,
  removedIds: Set<number>,
  failure: 'invalid-json' | 'invalid-manifest',
  reason: string,
  status: number,
  retryCount: number,
  identity: InvalidMarketplaceIdentity,
  request: string | null,
  now: () => string,
  log?: Log,
): null {
  const target = persistRepositoryMetadataOnMarketplaceError(db, runId, row, loaded, removedIds, now())
  if (identity.cacheOid) {
    runWhileActive(db, runId, () => {
      db.prepare('UPDATE repositories SET marketplace_failed_oid = ?, marketplace_failed_parser_version = ? WHERE id = ?').run(
        identity.cacheOid,
        MARKETPLACE_PARSER_VERSION,
        target.id,
      )
    })
  }
  recordProblem(db, runId, counts, row, invalidContentCategory(failure), loaded.ready, true, now, retryCount, log, {
    request,
    status,
    reason,
    ...(identity.marketplaceOid ? { marketplaceOid: identity.marketplaceOid } : {}),
    ...(identity.contentOid && identity.contentOid !== identity.marketplaceOid ? { contentOid: identity.contentOid } : {}),
  })
  return null
}

function recordKnownInvalidMarketplace(
  db: Database.Database,
  runId: string,
  counts: EnrichmentCounts,
  row: RepositoryRow,
  loaded: LoadedRepository,
  removedIds: Set<number>,
  now: () => string,
  log?: Log,
): null {
  const failedOid = row.marketplace_failed_oid
  const target = persistRepositoryMetadataOnMarketplaceError(db, runId, row, loaded, removedIds, now())
  if (failedOid) {
    runWhileActive(db, runId, () => {
      db.prepare('UPDATE repositories SET marketplace_failed_oid = ?, marketplace_failed_parser_version = ? WHERE id = ?').run(
        failedOid,
        MARKETPLACE_PARSER_VERSION,
        target.id,
      )
    })
  }
  counts.knownInvalidSkipped = (counts.knownInvalidSkipped ?? 0) + 1
  recordProblem(db, runId, counts, row, 'marketplace_known_invalid_content', loaded.ready, true, now, 0, log, {
    request: null,
    marketplaceOid: row.marketplace_failed_oid,
    reason: `Skipped unchanged marketplace OID rejected by parser version ${MARKETPLACE_PARSER_VERSION}`,
    skippedDownload: true,
  })
  return null
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
  policy: RestAttemptPolicy,
  log?: Log,
): Promise<MarketplaceState | null | RetryLater> {
  const parserVersionChanged = row.marketplace_parser_version !== MARKETPLACE_PARSER_VERSION
  const etag = row.marketplace_etag && !parserVersionChanged ? row.marketplace_etag : undefined
  let result: RepoResult<{ plugins: unknown[] }>
  try {
    result = await reader.getMarketplace(loaded.owner, loaded.repo, etag, { maxAttempts: policy.maxAttempts })
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
    const deferred = deferTransient(result, policy)
    if (deferred) return deferred
    recordProblem(
      db,
      runId,
      counts,
      row,
      temporaryCategory('marketplace', result),
      loaded.ready,
      false,
      now,
      totalRetryCount(result, policy),
      log,
      {
        request: `GET /repos/${loaded.owner}/${loaded.repo}/contents/.claude-plugin/marketplace.json`,
        status: result.status,
        reason: result.reason,
        failureReason: result.failureReason,
        retryable: result.retryable,
      },
    )
    return null
  }
  if (result.kind === 'invalid-content') {
    return recordInvalidMarketplace(
      db,
      runId,
      counts,
      row,
      loaded,
      removedIds,
      result.failure,
      result.reason,
      result.status,
      totalRetryCount(result, policy),
      { cacheOid: null, marketplaceOid: null, contentOid: null },
      `GET /repos/${loaded.owner}/${loaded.repo}/contents/.claude-plugin/marketplace.json`,
      now,
      log,
    )
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

function resolveGraphQLMarketplaceBlob(
  db: Database.Database,
  runId: string,
  row: RepositoryRow,
  loaded: LoadedRepository,
  currentMarketplaceOid: string,
  blob: GitHubGraphQLMarketplaceBlob,
  counts: EnrichmentCounts,
  removedIds: Set<number>,
  now: () => string,
  log?: Log,
): MarketplaceState | null | undefined {
  let decoded: MarketplaceBlobDecode
  try {
    decoded = decodeGraphQLMarketplaceBlob(blob)
  } catch {
    recordProblem(db, runId, counts, row, 'marketplace_parser_error', loaded.ready, true, now, 0, log, {
      request: 'POST /graphql',
      status: 200,
      reason: 'Marketplace parser failure',
      contentOid: blob.oid,
    })
    return null
  }
  if (decoded.kind === 'found') {
    return {
      pluginsCount: decoded.pluginsCount,
      marketplaceOid: decoded.marketplaceOid,
      marketplaceEtag: null,
      clearMarketplaceEtag: true,
      parserVersion: MARKETPLACE_PARSER_VERSION,
    }
  }
  if (decoded.kind === 'unsupported') return undefined
  if (blob.oid !== currentMarketplaceOid) {
    log?.({
      level: 'warn',
      event: 'crawl.marketplace_oid_changed_during_read',
      phase: 'enrichment',
      category: 'marketplace_oid_mismatch',
      runId,
      message: `Marketplace OID changed while reading ${loaded.owner}/${loaded.repo}; falling back to REST`,
      repository: `${loaded.owner}/${loaded.repo}`,
      repositoryId: row.id,
      repositoryUrl: row.html_url,
      request: 'POST /graphql',
      status: 200,
      marketplaceOid: currentMarketplaceOid,
      contentOid: blob.oid,
      fallback: 'REST',
    })
    return undefined
  }
  return recordInvalidMarketplace(
    db,
    runId,
    counts,
    row,
    loaded,
    removedIds,
    decoded.failure,
    decoded.reason,
    200,
    0,
    { cacheOid: blob.oid, marketplaceOid: currentMarketplaceOid, contentOid: blob.oid },
    'POST /graphql',
    now,
    log,
  )
}

function marketplaceRequestEtag(row: RepositoryRow, changedOid: boolean): string | undefined {
  if (row.marketplace_parser_version !== MARKETPLACE_PARSER_VERSION || changedOid || row.plugins_count === null) return undefined
  return row.marketplace_etag ?? undefined
}

async function loadGraphQLMarketplaceViaRest(
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
  policy: RestAttemptPolicy,
  log?: Log,
): Promise<MarketplaceState | null | RetryLater> {
  const authoritativeMarketplaceOid = blob?.oid ?? currentMarketplaceOid
  const changedOid = row.marketplace_oid !== authoritativeMarketplaceOid
  const etag = marketplaceRequestEtag(row, changedOid)
  let result: RepoResult<{ plugins: unknown[] }>
  try {
    result = await reader.getMarketplace(loaded.owner, loaded.repo, etag, { maxAttempts: policy.maxAttempts })
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
    const deferred = deferTransient(result, policy)
    if (deferred) return deferred
    recordProblem(
      db,
      runId,
      counts,
      row,
      temporaryCategory('marketplace', result),
      loaded.ready,
      false,
      now,
      totalRetryCount(result, policy),
      log,
      {
        request: `GET /repos/${loaded.owner}/${loaded.repo}/contents/.claude-plugin/marketplace.json`,
        status: result.status,
        reason: result.reason,
        failureReason: result.failureReason,
        retryable: result.retryable,
        marketplaceOid: currentMarketplaceOid,
      },
    )
    return null
  }
  if (result.kind === 'invalid-content') {
    return recordInvalidMarketplace(
      db,
      runId,
      counts,
      row,
      loaded,
      removedIds,
      result.failure,
      result.reason,
      result.status,
      totalRetryCount(result, policy),
      { cacheOid: null, marketplaceOid: currentMarketplaceOid, contentOid: blob?.oid ?? null },
      `GET /repos/${loaded.owner}/${loaded.repo}/contents/.claude-plugin/marketplace.json`,
      now,
      log,
    )
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
  policy: RestAttemptPolicy,
  log?: Log,
): Promise<MarketplaceState | null | RetryLater> {
  if (row.marketplace_failed_oid === currentMarketplaceOid && row.marketplace_failed_parser_version === MARKETPLACE_PARSER_VERSION) {
    return recordKnownInvalidMarketplace(db, runId, counts, row, loaded, removedIds, now, log)
  }
  if (!needsMarketplaceContent(row, currentMarketplaceOid)) {
    return {
      pluginsCount: row.plugins_count as number,
      marketplaceOid: currentMarketplaceOid,
      marketplaceEtag: row.marketplace_etag,
      parserVersion: MARKETPLACE_PARSER_VERSION,
    }
  }
  if (blob) {
    const resolved = resolveGraphQLMarketplaceBlob(db, runId, row, loaded, currentMarketplaceOid, blob, counts, removedIds, now, log)
    if (resolved !== undefined) return resolved
  }
  return loadGraphQLMarketplaceViaRest(db, reader, runId, row, loaded, currentMarketplaceOid, blob, counts, removedIds, now, policy, log)
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
  policy: RestAttemptPolicy,
  log?: Log,
): Promise<LoadedRepository | null | RetryLater> {
  let result: RepoResult<GitHubRepo>
  try {
    result = await reader.getRepository(identity.owner, identity.repo, row.repository_etag ?? undefined, {
      maxAttempts: policy.maxAttempts,
    })
  } catch (error) {
    if (error instanceof GitHubFatalError) logRepositoryFatalError(error, runId, row, identity, log)
    throw error
  }
  if (result.kind === 'not-found') return removeMissingRepository(db, runId, row, identity, counts, log)
  if (result.kind === 'temporary-error') {
    const deferred = deferTransient(result, policy)
    if (deferred) return deferred
    recordProblem(
      db,
      runId,
      counts,
      row,
      temporaryCategory('repository', result),
      previouslyReady,
      false,
      now,
      totalRetryCount(result, policy),
      log,
      {
        request: `GET /repos/${identity.owner}/${identity.repo}`,
        status: result.status,
        reason: result.reason,
        failureReason: result.failureReason,
        retryable: result.retryable,
      },
    )
    return null
  }
  if (result.kind === 'invalid-content') {
    recordProblem(db, runId, counts, row, 'repository_invalid_content', previouslyReady, true, now, totalRetryCount(result, policy), log, {
      request: `GET /repos/${identity.owner}/${identity.repo}`,
      status: result.status,
      reason: result.reason,
      failureReason: result.failureReason,
      retryable: result.retryable,
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
  policy: RestAttemptPolicy,
  retryQueue: RetryQueue | undefined,
  onProgress?: () => void,
  log?: Log,
): Promise<void> {
  if (removedIds.has(row.id)) return
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
  const loaded = await loadRepository(db, reader, runId, row, identity, previouslyReady, counts, now, policy, log)
  if (isRetryLater(loaded)) {
    queueRetry(retryQueue, row, async () => {
      if (removedIds.has(row.id)) return
      await beginDeferredRetry(reader, loaded)
      await enrichOne(db, reader, runId, row, counts, removedIds, now, RETRY_PASS_REST, undefined, onProgress, log)
    })
    return
  }
  if (!loaded) return
  onProgress?.()
  const marketplace = await loadLegacyMarketplace(db, reader, runId, row, loaded, counts, removedIds, now, policy, log)
  if (isRetryLater(marketplace)) {
    queueRetry(retryQueue, row, async () => {
      if (removedIds.has(row.id)) return
      await beginDeferredRetry(reader, marketplace)
      const retried = await loadLegacyMarketplace(db, reader, runId, row, loaded, counts, removedIds, now, RETRY_PASS_REST, log)
      if (!retried || isRetryLater(retried)) return
      const target = persistEnrichment(
        db,
        runId,
        row,
        loaded,
        retried.pluginsCount,
        retried.marketplaceOid,
        retried.marketplaceEtag,
        retried.parserVersion,
        now(),
      )
      completeEnrichment(counts, target, removedIds)
    })
    return
  }
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
  policy: RestAttemptPolicy,
  retryQueue: RetryQueue | undefined,
  onProgress?: () => void,
  log?: Log,
): Promise<void> {
  if (removedIds.has(row.id)) return
  if (data === null) {
    await enrichOne(db, reader, runId, row, counts, removedIds, now, policy, retryQueue, onProgress, log)
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
    ? await loadGraphQLMarketplace(
        db,
        reader,
        runId,
        row,
        loaded,
        loaded.marketplaceOid,
        marketplaceBlob,
        counts,
        removedIds,
        now,
        policy,
        log,
      )
    : await loadLegacyMarketplace(db, reader, runId, row, loaded, counts, removedIds, now, policy, log)
  if (isRetryLater(marketplace)) {
    queueRetry(retryQueue, row, () => {
      if (removedIds.has(row.id)) return Promise.resolve()
      await beginDeferredRetry(reader, marketplace)
      return enrichGraphQLOne(
        db,
        reader,
        runId,
        row,
        data,
        marketplaceBlob,
        counts,
        removedIds,
        now,
        RETRY_PASS_REST,
        undefined,
        onProgress,
        log,
      )
    })
    return
  }
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
type RepositoryProcessed = (row: RepositoryRow) => void

async function enrichLegacyBatch(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  rows: RepositoryRow[],
  counts: EnrichmentCounts,
  removedIds: Set<number>,
  now: () => string,
  policy: RestAttemptPolicy,
  retryQueue: RetryQueue | undefined,
  onProgress?: () => void,
  log?: Log,
  onRepositoryProcessed?: RepositoryProcessed,
): Promise<void> {
  for (const row of rows) {
    await enrichOne(db, reader, runId, row, counts, removedIds, now, policy, retryQueue, onProgress, log)
    if (!retryQueue?.deferredIds.has(row.id)) onRepositoryProcessed?.(row)
  }
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
  policy: RestAttemptPolicy,
  retryQueue: RetryQueue | undefined,
  onProgress?: () => void,
  log?: Log,
  onRepositoryProcessed?: RepositoryProcessed,
): Promise<void> {
  state.stableBatches = 0
  if (rows.length <= 10) {
    await enrichLegacyBatch(db, reader, runId, rows, counts, removedIds, now, policy, retryQueue, onProgress, log, onRepositoryProcessed)
    return
  }

  const smallerSize = rows.length > 25 ? 25 : 10
  state.size = smallerSize
  for (let offset = 0; offset < rows.length; offset += smallerSize) {
    await enrichGraphQLBatch(
      db,
      reader,
      runId,
      rows.slice(offset, offset + smallerSize),
      counts,
      removedIds,
      state,
      now,
      policy,
      retryQueue,
      onProgress,
      log,
      onRepositoryProcessed,
    )
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
  policy: RestAttemptPolicy,
  retryQueue: RetryQueue | undefined,
  onProgress?: () => void,
  log?: Log,
  onRepositoryProcessed?: RepositoryProcessed,
): Promise<void> {
  const getBatch = reader.getRepositoriesByNodeId
  if (!getBatch) {
    return enrichLegacyBatch(db, reader, runId, rows, counts, removedIds, now, policy, retryQueue, onProgress, log, onRepositoryProcessed)
  }

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
      failureReason: result.failureReason,
      retryable: result.retryable,
      batchSize: rows.length,
      repositoryUrls: rows.map((row) => row.html_url).filter((url): url is string => Boolean(url)),
      fallback: 'REST',
    })
    await recoverGraphQLBatch(
      db,
      reader,
      runId,
      rows,
      counts,
      removedIds,
      state,
      now,
      policy,
      retryQueue,
      onProgress,
      log,
      onRepositoryProcessed,
    )
    return
  }

  tuneGraphQLBatch(state, rows.length, latency, result.rateLimit.cost)
  const marketplaceBlobs = await loadGraphQLMarketplaceBlobs(runId, reader, rows, result.data, onProgress, log)
  for (const [index, row] of rows.entries()) {
    const marketplaceBlob = row.github_node_id ? (marketplaceBlobs.get(row.github_node_id) ?? null) : null
    await enrichGraphQLOne(
      db,
      reader,
      runId,
      row,
      result.data[index] ?? null,
      marketplaceBlob,
      counts,
      removedIds,
      now,
      policy,
      retryQueue,
      onProgress,
      log,
    )
    if (!retryQueue?.deferredIds.has(row.id)) onRepositoryProcessed?.(row)
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
    knownInvalidSkipped: 0,
  }
  let lastId = 0
  const removedIds = new Set<number>()
  const retryQueue: RetryQueue = { tasks: [], deferredIds: new Set<number>() }
  const processedIds = new Set<number>()
  const accountedRemovedIds = new Set<number>()
  const markRepositoryProcessed = (row: RepositoryRow) => {
    let processed = 0
    if (!processedIds.has(row.id)) {
      processedIds.add(row.id)
      processed++
    }
    if (removedIds.size !== accountedRemovedIds.size) {
      for (const removedId of removedIds) {
        if (accountedRemovedIds.has(removedId)) continue
        accountedRemovedIds.add(removedId)
        if (processedIds.has(removedId)) continue
        processedIds.add(removedId)
        processed++
      }
    }
    if (processed > 0) advanceRunPhase(db, runId, processed, now())
  }
  const batchState = { size: 25, stableBatches: 0 }
  while (true) {
    const rows = listForEnrichment(db, lastId, 50)
    if (rows.length === 0) break
    for (const row of rows) lastId = row.id
    const graphQLRows = rows.filter((row) => row.github_node_id && parseRepositoryUrl(row.html_url ?? ''))
    const legacyRows = rows.filter((row) => !row.github_node_id || !parseRepositoryUrl(row.html_url ?? ''))
    for (const row of legacyRows) {
      if (!removedIds.has(row.id)) {
        await enrichOne(db, reader, runId, row, counts, removedIds, now, FIRST_PASS_REST, retryQueue, onProgress, log)
      }
      if (!retryQueue.deferredIds.has(row.id)) markRepositoryProcessed(row)
    }
    for (let offset = 0; offset < graphQLRows.length; ) {
      const batch = graphQLRows.slice(offset, offset + batchState.size)
      offset += batch.length
      await enrichGraphQLBatch(
        db,
        reader,
        runId,
        batch,
        counts,
        removedIds,
        batchState,
        now,
        FIRST_PASS_REST,
        retryQueue,
        onProgress,
        log,
        markRepositoryProcessed,
      )
    }
    onProgress?.()
  }

  if (retryQueue.tasks.length > 0) {
    log?.({
      level: 'info',
      event: 'crawl.retry_queue_started',
      phase: 'enrichment',
      category: 'retry_queue',
      runId,
      message: `Retrying ${retryQueue.tasks.length} repositories after the first enrichment pass`,
      queued: retryQueue.tasks.length,
    })
  }
  for (const retry of retryQueue.tasks) {
    await retry.run()
    markRepositoryProcessed(retry.row)
    onProgress?.()
  }
  if (retryQueue.tasks.length > 0) {
    log?.({
      level: 'info',
      event: 'crawl.retry_queue_completed',
      phase: 'enrichment',
      category: 'retry_queue',
      runId,
      message: `Completed retry queue for ${retryQueue.tasks.length} repositories`,
      queued: retryQueue.tasks.length,
    })
  }
  return counts
}
