import type Database from 'better-sqlite3'
import type { GitHubReader } from '../github/client.js'
import { parseRepositoryUrl } from '../github/repositoryUrl.js'
import type { Log } from '../logging.js'
import { deleteById, getRepositoryById, listForHealthCheck, recordHealthCheck } from '../storage/repositories.js'
import { recordRunError, runWhileActive } from '../storage/runs.js'

export type HealthCheckSummary = { checked: number; deleted: number; renamed: number; warnings: number }

export async function healthCheck(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  heartbeat: () => void,
  now: () => string,
  log?: Log,
): Promise<HealthCheckSummary> {
  const counts: HealthCheckSummary = { checked: 0, deleted: 0, renamed: 0, warnings: 0 }
  // Older/custom readers can omit the lightweight HEAD capability.
  if (!reader.checkRepository) return counts
  log?.({
    level: 'info',
    event: 'crawl.phase_started',
    phase: 'health_check',
    category: 'phase_started',
    runId,
    message: 'Checking up to 200 oldest repository links',
  })
  for (const row of listForHealthCheck(db)) {
    heartbeat()
    // A preceding redirect may already have merged this duplicate away.
    if (!getRepositoryById(db, row.id)) continue
    const identity = row.html_url ? parseRepositoryUrl(row.html_url) : null
    if (!identity) continue
    const result = await reader.checkRepository(identity.owner, identity.repo)
    heartbeat()
    const at = now()
    runWhileActive(db, runId, () => {
      counts.checked++
      if (result.kind === 'not-found') {
        deleteById(db, row.id)
        counts.deleted++
        return
      }
      const canonicalUrl = result.kind === 'found' ? result.data.html_url : undefined
      recordHealthCheck(db, row.id, at, canonicalUrl)
      if (canonicalUrl && canonicalUrl !== row.html_url) counts.renamed++
      if (result.kind === 'temporary-error') {
        counts.warnings++
        recordRunError(db, {
          run_id: runId,
          phase: 'health_check',
          repository_id: row.id,
          error_type: `health_check_${result.status === null ? 'network' : `http_${result.status}`}`,
          retry_count: result.retryCount,
          occurred_at: at,
        })
      }
    })
  }
  log?.({
    level: 'info',
    event: 'crawl.phase_completed',
    phase: 'health_check',
    category: 'phase_completed',
    runId,
    message: `Health check completed: ${counts.checked} checked, ${counts.deleted} removed, ${counts.renamed} renamed`,
    ...counts,
  })
  return counts
}
