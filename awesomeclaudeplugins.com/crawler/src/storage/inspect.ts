import type Database from 'better-sqlite3'
import { readDiscoverySource } from './discoverySources.js'
import { repositorySearchCoverage } from './repositorySearch.js'

export function inspect(db: Database.Database, now = new Date()) {
  const code = readDiscoverySource(db, 'code_search')
  const repo = readDiscoverySource(db, 'repo_search')
  const coverage = repositorySearchCoverage(db, now.toISOString())
  const codeStale = !code.lastCompleteScan || Date.parse(code.lastCompleteScan) <= now.getTime() - 86_400_000
  const codeFreshness = !code.lastAttempt ? 'never_run' : code.state === 'incomplete' ? 'incomplete' : codeStale ? 'stale' : 'fresh'

  const counts = db
    .prepare(`
    SELECT (SELECT COUNT(*) FROM repositories) AS repositories,
           (SELECT COUNT(*) FROM repositories WHERE html_url IS NOT NULL AND TRIM(html_url, char(9) || char(10) || char(11) || char(12) || char(13) || ' ') <> '') AS nonemptyUrls,
           (SELECT COUNT(*) FROM repositories WHERE html_url IS NULL OR TRIM(html_url, char(9) || char(10) || char(11) || char(12) || char(13) || ' ') = '') AS missingUrls,
           (SELECT COUNT(*) FROM stats) AS stats,
           (SELECT MIN(id) FROM repositories) AS minRepositoryId,
           (SELECT MAX(id) FROM repositories) AS maxRepositoryId,
           (SELECT MIN(id) FROM stats) AS minStatsId,
           (SELECT MAX(id) FROM stats) AS maxStatsId
  `)
    .get() as Record<string, number | null>
  return {
    ...counts,
    coverageScope: 'configured_query_catalog' as const,
    coverageNote: 'Coverage is bounded to the configured queries and API limits; it does not establish GitHub-wide completeness.',
    sources: {
      code_search: {
        lastCompleteScan: code.lastCompleteScan ?? null,
        lastAttempt: code.lastAttempt ?? null,
        freshness: codeFreshness,
        due: codeFreshness !== 'fresh',
        stale: codeStale,
        incompletePartitions: code.incompletePartitions ?? (code.state === 'incomplete' ? 1 : 0),
        warnings: code.state === 'incomplete' ? ['incomplete_scan'] : [],
      },
      repo_search: {
        ...coverage,
        freshness:
          repo.state === 'incomplete'
            ? 'incomplete'
            : coverage.freshness === 'never_run' && repo.lastAttempt
              ? 'stale'
              : coverage.freshness,
        due: repo.state === 'incomplete' || coverage.due,
        incompletePartitions: Math.max(coverage.incompletePartitions, repo.incompletePartitions ?? 0),
        warnings: [...new Set([...coverage.warnings, ...(repo.warnings ?? [])])],
        lastCompleteScan: repo.lastCompleteScan ?? coverage.lastCompleteScan,
        lastAttempt: repo.lastAttempt ?? null,
        rollingIncompleteStreak: repo.rollingIncompleteStreak ?? 0,
        repeatedIncompletePartitions: repo.repeatedIncompletePartitions ?? [],
        alerts: [
          ...((repo.rollingIncompleteStreak ?? 0) >= 2 ? ['rolling_partition_repeatedly_incomplete'] : []),
          ...((repo.repeatedIncompletePartitions?.length ?? 0) > 0 ? ['partition_repeatedly_incomplete'] : []),
        ],
      },
    },
    integrity: db.pragma('integrity_check', { simple: true }) as string,
    foreignKeyViolations: db.pragma('foreign_key_check') as { table: string; rowid: number | null; parent: string; fkid: number }[],
  }
}
