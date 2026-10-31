import type Database from 'better-sqlite3'

/** Rejections are durable across runs, independent of deleted repository rows. */
export function recordRejectedCandidate(db: Database.Database, htmlUrl: string, githubNodeId: string | null, rejectedAt: string): void {
  db.prepare(`
    INSERT INTO rejected_repository_candidates (html_url, github_node_id, rejected_at)
    VALUES (?, ?, ?)
    ON CONFLICT(html_url) DO UPDATE SET
      github_node_id = excluded.github_node_id,
      rejected_at = excluded.rejected_at
  `).run(htmlUrl, githubNodeId, rejectedAt)
}

/** Allow a previously rejected repository to be retried only after GitHub reports a newer push.
 * A missing push timestamp means it has no evidence of changed marketplace content. */
export function isUnchangedRejectedCandidate(
  db: Database.Database,
  htmlUrl: string,
  githubNodeId: string | null | undefined,
  pushedAt: string | null | undefined,
): boolean {
  const rejected = db
    .prepare(`
    SELECT rejected_at FROM rejected_repository_candidates
    WHERE html_url = ? COLLATE NOCASE OR (github_node_id IS NOT NULL AND github_node_id = ?)
    ORDER BY rejected_at DESC LIMIT 1
  `)
    .get(htmlUrl, githubNodeId ?? null) as { rejected_at: string } | undefined
  if (!rejected) return false
  const pushed = pushedAt ? Date.parse(pushedAt) : Number.NaN
  const rejectedTime = Date.parse(rejected.rejected_at)
  if (Number.isFinite(pushed) && Number.isFinite(rejectedTime) && pushed > rejectedTime) {
    db.prepare(`
      DELETE FROM rejected_repository_candidates
      WHERE html_url = ? COLLATE NOCASE OR (github_node_id IS NOT NULL AND github_node_id = ?)
    `).run(htmlUrl, githubNodeId ?? null)
    return false
  }
  return true
}
