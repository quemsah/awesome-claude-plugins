import type Database from 'better-sqlite3'
import { type GitHubReader, GitHubTemporaryError } from '../github/client.js'
import { parseRepositoryUrl } from '../github/repositoryUrl.js'
import { SIZE_RANGES, type SizeRange } from '../github/sizeRanges.js'
import { upsertDiscovery } from '../storage/repositories.js'
import { recordRunError } from '../storage/runs.js'

export type DiscoveryWarningCategory = 'saturated' | 'page-limit' | 'incomplete-results' | 'temporary-error' | 'invalid-url' | 'short-page'

export type DiscoveryWarning = { range: SizeRange; category: DiscoveryWarningCategory }

export type DiscoverySummary = {
  newUrls: number
  existingUrls: number
  /** A range counts after at least one successful search response, including an empty first page. */
  successfulRanges: number
  warningCount: number
  warnings: DiscoveryWarning[]
}

type RangeState = {
  runId: string
  range: SizeRange
  warned: Set<DiscoveryWarningCategory>
  summary: DiscoverySummary
  now: () => string
}

function warn(db: Database.Database, state: RangeState, category: DiscoveryWarningCategory): void {
  if (state.warned.has(category)) return
  state.warned.add(category)
  const [min, max] = state.range
  recordRunError(db, {
    run_id: state.runId,
    phase: 'search',
    range_start: min,
    range_end: max,
    error_type: category,
    retry_count: 0,
    occurred_at: state.now(),
  })
  state.summary.warnings.push({ range: state.range, category })
  state.summary.warningCount++
}

async function searchPage(
  reader: GitHubReader,
  query: string,
  page: number,
  db: Database.Database,
  state: RangeState,
): Promise<Awaited<ReturnType<GitHubReader['searchCode']>> | null> {
  try {
    return await reader.searchCode(query, page)
  } catch (error) {
    if (!(error instanceof GitHubTemporaryError) || error.status === 401 || error.status === 422) throw error
    warn(db, state, 'temporary-error')
    return null
  }
}

function processItems(
  db: Database.Database,
  lookup: Database.Statement,
  result: Awaited<ReturnType<GitHubReader['searchCode']>>,
  state: RangeState,
): void {
  for (const { repository } of result.items) {
    if (repository.private === true) continue
    const url = repository.html_url
    if (!parseRepositoryUrl(url)) {
      warn(db, state, 'invalid-url')
      continue
    }
    if (lookup.get(url)) state.summary.existingUrls++
    else state.summary.newUrls++
    upsertDiscovery(db, url, repository.description, state.now())
  }
}

function recordPageWarnings(
  db: Database.Database,
  result: Awaited<ReturnType<GitHubReader['searchCode']>>,
  page: number,
  state: RangeState,
): void {
  if (result.total_count >= 1000) warn(db, state, 'saturated')
  if (result.incomplete_results) warn(db, state, 'incomplete-results')
  if (page === 10 && result.items.length === 100) warn(db, state, 'page-limit')
}

async function searchRange(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  lookup: Database.Statement,
  range: SizeRange,
  summary: DiscoverySummary,
  now: () => string,
): Promise<void> {
  const [min, max] = range
  const query = `filename:marketplace.json path:.claude-plugin size:${min}..${max}`
  const state: RangeState = { runId, range, warned: new Set(), summary, now }
  let found = 0
  for (let page = 1; page <= 10; page++) {
    const result = await searchPage(reader, query, page, db, state)
    if (!result) break
    if (page === 1) summary.successfulRanges++
    recordPageWarnings(db, result, page, state)
    processItems(db, lookup, result, state)
    found += result.items.length
    if (result.items.length < 100 && found < result.total_count) warn(db, state, 'short-page')
    if (result.items.length < 100 || found >= result.total_count) break
  }
}

export async function discover(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  ranges: readonly SizeRange[] = SIZE_RANGES,
  onRangeComplete?: () => void,
  now: () => string = () => new Date().toISOString(),
): Promise<DiscoverySummary> {
  const summary: DiscoverySummary = { newUrls: 0, existingUrls: 0, successfulRanges: 0, warningCount: 0, warnings: [] }
  const lookup = db.prepare('SELECT id FROM repositories WHERE html_url = ? COLLATE NOCASE LIMIT 1')

  for (const range of ranges) {
    await searchRange(db, reader, runId, lookup, range, summary, now)
    onRangeComplete?.()
  }

  return summary
}
