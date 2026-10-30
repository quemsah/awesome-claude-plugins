import type Database from 'better-sqlite3'

export function inspect(db: Database.Database) {
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
    integrity: db.pragma('integrity_check', { simple: true }) as string,
    foreignKeyViolations: db.pragma('foreign_key_check') as { table: string; rowid: number | null; parent: string; fkid: number }[],
  }
}
