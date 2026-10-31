import type Database from 'better-sqlite3'

export type DiscoverySource = 'code_search' | 'repo_search'

export function recordDiscoveryCandidate(
  db: Database.Database,
  runId: string,
  repositoryId: number,
  source: DiscoverySource,
  queryId: string,
): void {
  db.prepare(`
    INSERT OR IGNORE INTO discovery_candidates (run_id, repository_id, source, query_id)
    VALUES (?, ?, ?, ?)
  `).run(runId, repositoryId, source, queryId)
}

export function discoveryYield(db: Database.Database, runId: string, source?: DiscoverySource) {
  return db
    .prepare(`
    SELECT COUNT(*) AS uniqueCandidates,
      COALESCE(SUM(CASE WHEN r.plugins_count > 0 THEN 1 ELSE 0 END), 0) AS acceptedMarketplaces,
      COALESCE(SUM(CASE WHEN r.id IS NULL OR r.plugins_count = 0 THEN 1 ELSE 0 END), 0) AS rejectedCandidates,
      COALESCE(SUM(CASE WHEN r.id IS NOT NULL AND r.plugins_count IS NULL THEN 1 ELSE 0 END), 0) AS pendingCandidates
    FROM (SELECT DISTINCT repository_id FROM discovery_candidates WHERE run_id = ? AND (? IS NULL OR source = ?)) c
    LEFT JOIN repositories r ON r.id = c.repository_id
  `)
    .get(runId, source ?? null, source ?? null) as {
    uniqueCandidates: number
    acceptedMarketplaces: number
    rejectedCandidates: number
    pendingCandidates: number
  }
}
