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

export async function discover(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  ranges: readonly SizeRange[] = SIZE_RANGES,
  onRangeComplete?: () => void,
): Promise<DiscoverySummary> {
  const summary: DiscoverySummary = { newUrls: 0, existingUrls: 0, successfulRanges: 0, warningCount: 0, warnings: [] }
  const lookup = db.prepare('SELECT id FROM repositories WHERE html_url = ?')

  for (const range of ranges) {
    const [min, max] = range
    const query = `filename:marketplace.json path:.claude-plugin size:${min}..${max}`
    const warned = new Set<DiscoveryWarningCategory>()
    const warn = (category: DiscoveryWarningCategory) => {
      if (warned.has(category)) return
      warned.add(category)
      recordRunError(db, {
        run_id: runId,
        phase: 'search',
        range_start: min,
        range_end: max,
        error_type: category,
        retry_count: 0,
        occurred_at: new Date().toISOString(),
      })
      summary.warnings.push({ range, category })
      summary.warningCount++
    }

    let found = 0
    for (let pageNumber = 1; pageNumber <= 10; pageNumber++) {
      let result: Awaited<ReturnType<GitHubReader['searchCode']>>
      try {
        result = await reader.searchCode(query, pageNumber)
      } catch (error) {
        if (!(error instanceof GitHubTemporaryError)) throw error
        if (error.status === 401 || error.status === 422) throw error
        warn('temporary-error')
        break
      }

      if (pageNumber === 1) summary.successfulRanges++
      if (result.total_count >= 1000) warn('saturated')
      if (result.incomplete_results) warn('incomplete-results')

      for (const { repository } of result.items) {
        const url = repository.html_url
        if (!parseRepositoryUrl(url)) {
          warn('invalid-url')
          continue
        }
        if (lookup.get(url)) summary.existingUrls++
        else summary.newUrls++
        upsertDiscovery(db, url, repository.description)
      }

      found += result.items.length
      if (pageNumber === 10 && result.items.length === 100) warn('page-limit')
      if (result.items.length < 100) {
        if (found < result.total_count) warn('short-page')
        break
      }
      if (found >= result.total_count) break
    }
    onRangeComplete?.()
  }

  return summary
}
