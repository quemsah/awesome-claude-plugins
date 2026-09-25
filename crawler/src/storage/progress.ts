import type Database from 'better-sqlite3'

export type CrawlProgressInspection = {
  run: {
    runId: string
    status: string
    startedAt: string
    heartbeatAt: string
    completedAt: string | null
    publishedAt: string | null
    warningCount: number
    lastError: string | null
  } | null
  repositories: {
    total: number
    updatedSinceRunStart: number | null
    enrichedSinceRunStart: number | null
    latestUpdatedAt: string | null
    updatedPercent: number | null
  }
  errors: {
    count: number
    latestAt: string | null
  } | null
}

type LatestRun = NonNullable<CrawlProgressInspection['run']>

/** Returns persisted progress for the latest crawl without modifying the database. */
export function inspectProgress(db: Database.Database): CrawlProgressInspection {
  const run =
    (db
      .prepare(`
      SELECT run_id AS runId,
             status,
             started_at AS startedAt,
             heartbeat_at AS heartbeatAt,
             completed_at AS completedAt,
             published_at AS publishedAt,
             warning_count AS warningCount,
             last_error AS lastError
      FROM runs
      ORDER BY started_at DESC, rowid DESC
      LIMIT 1
      `)
      .get() as LatestRun | undefined) ?? null

  if (!run) {
    const repositories = db.prepare('SELECT COUNT(*) AS total, MAX(updatedAt) AS latestUpdatedAt FROM repositories').get() as {
      total: number
      latestUpdatedAt: string | null
    }
    return {
      run: null,
      repositories: {
        total: repositories.total,
        updatedSinceRunStart: null,
        enrichedSinceRunStart: null,
        latestUpdatedAt: repositories.latestUpdatedAt,
        updatedPercent: null,
      },
      errors: null,
    }
  }

  const repositories = db
    .prepare(`
      SELECT COUNT(*) AS total,
             COUNT(CASE WHEN updatedAt >= @startedAt THEN 1 END) AS updatedSinceRunStart,
             COUNT(
               CASE
                 WHEN updatedAt >= @startedAt
                  AND html_url IS NOT NULL
                  AND owner IS NOT NULL
                  AND owner_url IS NOT NULL
                  AND repo_name IS NOT NULL
                  AND stargazers_count IS NOT NULL
                  AND forks_count IS NOT NULL
                  AND subscribers_count IS NOT NULL
                 THEN 1
               END
             ) AS enrichedSinceRunStart,
             MAX(updatedAt) AS latestUpdatedAt
      FROM repositories
    `)
    .get({ startedAt: run.startedAt }) as {
    total: number
    updatedSinceRunStart: number
    enrichedSinceRunStart: number
    latestUpdatedAt: string | null
  }

  const errors = db.prepare('SELECT COUNT(*) AS count, MAX(occurred_at) AS latestAt FROM run_errors WHERE run_id = ?').get(run.runId) as {
    count: number
    latestAt: string | null
  }

  return {
    run,
    repositories: {
      ...repositories,
      updatedPercent: repositories.total === 0 ? 100 : Math.round((repositories.updatedSinceRunStart / repositories.total) * 10_000) / 100,
    },
    errors,
  }
}
