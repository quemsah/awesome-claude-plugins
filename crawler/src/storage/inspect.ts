import type Database from 'better-sqlite3'

export function inspect(db: Database.Database) {
  const counts = db
    .prepare(`
    SELECT (SELECT COUNT(*) FROM repositories) AS repositories,
           (SELECT COUNT(*) FROM repositories WHERE html_url IS NOT NULL) AS nonemptyUrls,
           (SELECT COUNT(*) FROM repositories WHERE html_url IS NULL) AS missingUrls,
           (SELECT COUNT(*) FROM stats) AS stats,
           (SELECT MIN(id) FROM repositories) AS minRepositoryId,
           (SELECT MAX(id) FROM repositories) AS maxRepositoryId,
           (SELECT MIN(id) FROM stats) AS minStatsId,
           (SELECT MAX(id) FROM stats) AS maxStatsId
  `)
    .get() as Record<string, number | null>
  return { ...counts, integrity: db.pragma('integrity_check', { simple: true }) as string }
}
