import type Database from 'better-sqlite3'
import { hasCanonicalIdentity, listPublishable, type PublishableRepository } from './repositories.js'

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
    publishable: number
    incomplete: number
    invalidIdentity: number
    missingMarketplace: number
    updatedThisRun: number | null
    pendingThisRun: number | null
    updatedSinceRunStart: number | null
    enrichedSinceRunStart: number | null
    latestUpdatedAt: string | null
    updatedPercent: number | null
  }
  publication: {
    lastPublishedSize: number | null
    currentPublishableSize: number
    delta: number | null
  }
  errors: {
    count: number
    latestAt: string | null
  } | null
}

type LatestRun = NonNullable<CrawlProgressInspection['run']>

type RepositoryBreakdown = {
  total: number
  coreComplete: number
  latestUpdatedAt: string | null
}

function repositoryBreakdown(db: Database.Database): RepositoryBreakdown {
  return db
    .prepare(`
      SELECT
        COUNT(*) AS total,
        COUNT(
          CASE
            WHEN html_url IS NOT NULL
              AND owner IS NOT NULL
              AND owner_url IS NOT NULL
              AND repo_name IS NOT NULL
              AND stargazers_count IS NOT NULL
              AND forks_count IS NOT NULL
              AND subscribers_count IS NOT NULL
            THEN 1
          END
        ) AS coreComplete,
        MAX(updatedAt) AS latestUpdatedAt
      FROM repositories
    `)
    .get() as RepositoryBreakdown
}

function listCoreComplete(db: Database.Database): PublishableRepository[] {
  return db
    .prepare(`
      SELECT id, html_url, stargazers_count, forks_count, subscribers_count,
             description, owner, owner_url, repo_name, plugins_count
      FROM repositories
      WHERE html_url IS NOT NULL AND owner IS NOT NULL AND repo_name IS NOT NULL AND owner_url IS NOT NULL
        AND stargazers_count IS NOT NULL AND forks_count IS NOT NULL
        AND subscribers_count IS NOT NULL
      ORDER BY id
    `)
    .all() as PublishableRepository[]
}

function publicationState(db: Database.Database, currentPublishableSize: number): CrawlProgressInspection['publication'] {
  const latest = db.prepare('SELECT size FROM stats ORDER BY id DESC LIMIT 1').get() as { size: number } | undefined
  const lastPublishedSize = latest?.size ?? null
  return {
    lastPublishedSize,
    currentPublishableSize,
    delta: lastPublishedSize === null ? null : currentPublishableSize - lastPublishedSize,
  }
}

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

  const breakdown = repositoryBreakdown(db)
  const coreCompleteRows = listCoreComplete(db)
  const publishableRows = listPublishable(db)
  const publishable = publishableRows.length
  const repositoryState = {
    total: breakdown.total,
    publishable,
    incomplete: breakdown.total - breakdown.coreComplete,
    invalidIdentity: coreCompleteRows.filter((row) => !hasCanonicalIdentity(row)).length,
    missingMarketplace: publishableRows.filter((row) => row.plugins_count === null).length,
    latestUpdatedAt: breakdown.latestUpdatedAt,
  }
  const publication = publicationState(db, publishable)

  if (!run) {
    return {
      run: null,
      repositories: {
        ...repositoryState,
        updatedThisRun: null,
        pendingThisRun: null,
        updatedSinceRunStart: null,
        enrichedSinceRunStart: null,
        updatedPercent: null,
      },
      publication,
      errors: null,
    }
  }

  const repositories = db
    .prepare(`
      SELECT
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
        ) AS enrichedSinceRunStart
      FROM repositories
    `)
    .get({ startedAt: run.startedAt }) as {
    updatedSinceRunStart: number
    enrichedSinceRunStart: number
  }

  const errors = db.prepare('SELECT COUNT(*) AS count, MAX(occurred_at) AS latestAt FROM run_errors WHERE run_id = ?').get(run.runId) as {
    count: number
    latestAt: string | null
  }

  const attemptedErrors = db
    .prepare(`
      SELECT COUNT(DISTINCT run_errors.repository_id) AS count
      FROM run_errors
      LEFT JOIN repositories ON repositories.id = run_errors.repository_id
      WHERE run_errors.run_id = @runId
        AND run_errors.phase = 'enrich'
        AND run_errors.repository_id IS NOT NULL
        AND NOT (
          repositories.updatedAt >= @startedAt
          AND repositories.html_url IS NOT NULL
          AND repositories.owner IS NOT NULL
          AND repositories.owner_url IS NOT NULL
          AND repositories.repo_name IS NOT NULL
          AND repositories.stargazers_count IS NOT NULL
          AND repositories.forks_count IS NOT NULL
          AND repositories.subscribers_count IS NOT NULL
        )
    `)
    .get({ runId: run.runId, startedAt: run.startedAt }) as { count: number }

  const updatedThisRun = repositories.enrichedSinceRunStart
  const pendingThisRun = Math.max(0, repositoryState.total - updatedThisRun - attemptedErrors.count)

  return {
    run,
    repositories: {
      ...repositoryState,
      updatedThisRun,
      pendingThisRun,
      ...repositories,
      updatedPercent: repositoryState.total === 0 ? 100 : Math.round((updatedThisRun / repositoryState.total) * 10_000) / 100,
    },
    publication,
    errors,
  }
}
