import type Database from 'better-sqlite3'
import { hasCanonicalIdentity, isPublishableRepository, listCoreComplete } from './repositories.js'

export type CrawlProgressInspection = {
  run: {
    runId: string
    status: string
    phase: string
    phaseStartedAt: string | null
    phaseTotal: number | null
    phaseProcessed: number
    phasePercent: number | null
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
    invalidMetrics: number
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
  latestUpdatedAt: string | null
}

function repositoryBreakdown(db: Database.Database): RepositoryBreakdown {
  return db.prepare('SELECT COUNT(*) AS total, MAX(updatedAt) AS latestUpdatedAt FROM repositories').get() as RepositoryBreakdown
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
  return db.transaction(() => inspectProgressSnapshot(db))()
}

function inspectProgressSnapshot(db: Database.Database): CrawlProgressInspection {
  const run =
    (db
      .prepare(`
      SELECT run_id AS runId,
             status,
             phase,
             phase_started_at AS phaseStartedAt,
             phase_total AS phaseTotal,
             phase_processed AS phaseProcessed,
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
  const publishableRows = coreCompleteRows.filter(isPublishableRepository)
  const publishable = publishableRows.length
  const repositoryState = {
    total: breakdown.total,
    publishable,
    incomplete: breakdown.total - coreCompleteRows.length,
    invalidIdentity: coreCompleteRows.filter((row) => !hasCanonicalIdentity(row)).length,
    invalidMetrics: coreCompleteRows.filter((row) => hasCanonicalIdentity(row) && !isPublishableRepository(row)).length,
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

  const phasePercent =
    run.phase === 'enrichment' && run.phaseTotal !== null
      ? run.phaseTotal === 0
        ? 100
        : Math.round((run.phaseProcessed / run.phaseTotal) * 10_000) / 100
      : null
  const updatedThisRun = repositories.enrichedSinceRunStart
  const updatedPercent =
    run.phase === 'enrichment' && run.phaseTotal !== null
      ? run.phaseTotal === 0
        ? 100
        : Math.min(100, Math.round((updatedThisRun / run.phaseTotal) * 10_000) / 100)
      : null
  const pendingThisRun = run.phase === 'enrichment' && run.phaseTotal !== null ? Math.max(0, run.phaseTotal - run.phaseProcessed) : null

  return {
    run: { ...run, phasePercent },
    repositories: {
      ...repositoryState,
      updatedThisRun,
      pendingThisRun,
      ...repositories,
      updatedPercent,
    },
    publication,
    errors,
  }
}
