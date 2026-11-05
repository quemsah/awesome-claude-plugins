import type Database from 'better-sqlite3'
import type { GitHubReader } from '../github/client.js'
import { parseRepositoryUrl } from '../github/repositoryUrl.js'
import type { Log } from '../logging.js'
import { throwIfShutdown } from '../shutdown.js'
import {
  clearRepositoryBlocked,
  deleteById,
  getRepositoryById,
  listForHealthCheck,
  markRepositoryBlocked,
  recordHealthCheck,
} from '../storage/repositories.js'
import { recordRunError, runWhileActive } from '../storage/runs.js'

export type HealthCheckSummary = { checked: number; deleted: number; renamed: number; warnings: number }

export async function healthCheck(
  db: Database.Database,
  reader: GitHubReader,
  runId: string,
  heartbeat: () => void,
  now: () => string,
  log?: Log,
  options: { signal?: AbortSignal } = {},
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
  const rows = listForHealthCheck(db, now())
  const controller = new AbortController()
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, 30_000)
  let cursor = 0
  const check = reader.checkRepository.bind(reader)
  const worker = async () => {
    try {
      while (!signal.aborted && cursor < rows.length) {
        const row = rows[cursor++]
        heartbeat()
        if (!getRepositoryById(db, row.id)) continue
        const identity = row.html_url ? parseRepositoryUrl(row.html_url) : null
        const result = identity ? await check(identity.owner, identity.repo, { signal }) : null
        throwIfShutdown(options.signal)
        if (signal.aborted) break
        heartbeat()
        const at = now()
        runWhileActive(db, runId, () => {
          // A concurrent redirect may already have merged this row away.
          if (!getRepositoryById(db, row.id)) return
          counts.checked++
          if (result?.kind === 'not-found') {
            deleteById(db, row.id)
            counts.deleted++
            return
          }
          if (result?.kind === 'repository-blocked') {
            markRepositoryBlocked(db, row.id, result.blockReason ?? result.reason, at, at)
            db.prepare('UPDATE repositories SET last_health_check_at = ? WHERE id = ?').run(at, row.id)
            counts.warnings++
            recordRunError(db, {
              run_id: runId,
              phase: 'health_check',
              repository_id: row.id,
              error_type: 'health_check_repository_blocked',
              retry_count: result.retryCount ?? 0,
              occurred_at: at,
            })
            return
          }
          if (result?.kind === 'found') {
            clearRepositoryBlocked(db, row.id)
          }
          const canonicalUrl = result?.kind === 'found' ? result.data.html_url : undefined
          recordHealthCheck(db, row.id, at, canonicalUrl)
          if (canonicalUrl && canonicalUrl !== row.html_url) counts.renamed++
          if (!result || result.kind === 'temporary-error') {
            counts.warnings++
            recordRunError(db, {
              run_id: runId,
              phase: 'health_check',
              repository_id: row.id,
              error_type: !result
                ? 'health_check_invalid_url'
                : `health_check_${result.status === null ? 'network' : `http_${result.status}`}`,
              retry_count: result?.retryCount ?? 0,
              occurred_at: at,
            })
          }
        })
      }
    } catch (error) {
      if (timedOut) return
      controller.abort()
      throw error
    }
  }
  try {
    // Wait for cancellation to settle, including on errors; no writes may outlive this phase.
    const workers = await Promise.allSettled(Array.from({ length: 4 }, worker))
    throwIfShutdown(options.signal)
    const failure = workers.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
    if (timedOut) {
      heartbeat()
      runWhileActive(db, runId, () => {
        counts.warnings++
        recordRunError(db, { run_id: runId, phase: 'health_check', error_type: 'health_check_timeout', retry_count: 0, occurred_at: now() })
      })
    }
  } finally {
    clearTimeout(timer)
    controller.abort()
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
