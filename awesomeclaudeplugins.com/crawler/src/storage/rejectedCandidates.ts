import type Database from 'better-sqlite3'

export const REPOSITORY_ELIGIBILITY_VERSION = 2

/** Rejections are durable across runs, independent of deleted repository rows. */
export function recordRejectedCandidate(db: Database.Database, htmlUrl: string, githubNodeId: string | null, rejectedAt: string): void {
  db.prepare(`
    INSERT INTO rejected_repository_candidates (html_url, github_node_id, rejected_at, eligibility_version)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(html_url) DO UPDATE SET
      github_node_id = excluded.github_node_id,
      rejected_at = excluded.rejected_at,
      eligibility_version = excluded.eligibility_version
  `).run(htmlUrl, githubNodeId, rejectedAt, REPOSITORY_ELIGIBILITY_VERSION)
}

/** Allow a previously rejected repository to be retried only after GitHub reports a newer push.
 * A missing push timestamp means it has no evidence of changed marketplace content. */
export function isUnchangedRejectedCandidate(
  db: Database.Database,
  htmlUrl: string,
  githubNodeId: string | null | undefined,
  pushedAt: string | null | undefined,
  now?: string,
): boolean {
  const rejected = db
    .prepare(`
    SELECT rejected_at, eligibility_version FROM rejected_repository_candidates
    WHERE (html_url = ? COLLATE NOCASE AND (github_node_id IS NULL OR ? IS NULL OR github_node_id = ?))
       OR (github_node_id IS NOT NULL AND github_node_id = ?)
    ORDER BY rejected_at DESC LIMIT 1
  `)
    .get(htmlUrl, githubNodeId ?? null, githubNodeId ?? null, githubNodeId ?? null) as
    | { rejected_at: string; eligibility_version: number }
    | undefined
  if (!rejected) return false
  const pushed = pushedAt ? Date.parse(pushedAt) : Number.NaN
  const rejectedTime = Date.parse(rejected.rejected_at)
  // Code Search has no pushed_at; give a previously rejected repository a new chance after 90 days.
  const recheckDue = now !== undefined && Number.isFinite(rejectedTime) && Date.parse(now) - rejectedTime >= 90 * 86_400_000
  if (
    rejected.eligibility_version !== REPOSITORY_ELIGIBILITY_VERSION ||
    (Number.isFinite(pushed) && Number.isFinite(rejectedTime) && pushed > rejectedTime) ||
    recheckDue
  ) {
    db.prepare(`
      DELETE FROM rejected_repository_candidates
      WHERE (html_url = ? COLLATE NOCASE AND (github_node_id IS NULL OR ? IS NULL OR github_node_id = ?))
         OR (github_node_id IS NOT NULL AND github_node_id = ?)
    `).run(htmlUrl, githubNodeId ?? null, githubNodeId ?? null, githubNodeId ?? null)
    return false
  }
  return true
}
