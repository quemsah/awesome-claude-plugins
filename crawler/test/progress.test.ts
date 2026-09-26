import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCli } from '../src/cli.js'
import { openDatabase } from '../src/storage/db.js'
import { populateFixture } from '../src/storage/fixtureDb.js'
import { inspectProgress } from '../src/storage/progress.js'
import { upsertDiscovery } from '../src/storage/repositories.js'
import { advanceRunPhase, beginRun, recordRunError, startRunPhase } from '../src/storage/runs.js'

const scratch: string[] = []

function databasePath(): string {
  const directory = mkdtempSync(join(import.meta.dirname, '.scratch-progress-'))
  scratch.push(directory)
  return join(directory, 'catalog.sqlite')
}

afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('crawl progress inspection', () => {
  it('reports repository and publication breakdown for the latest run', () => {
    const db = openDatabase(databasePath())
    populateFixture(db)
    beginRun(db, 'current-run', '2026-09-24T08:34:58.000Z')
    startRunPhase(db, 'current-run', 'enrichment', '2026-09-24T08:50:00.000Z', 5)
    db.prepare("UPDATE repositories SET updatedAt = '2026-09-24T09:00:00.000Z' WHERE id = 1").run()
    db.prepare("UPDATE repositories SET updatedAt = '2026-09-24T09:05:00.000Z' WHERE id = 8").run()
    recordRunError(db, {
      run_id: 'current-run',
      phase: 'enrich',
      repository_id: 8,
      error_type: 'repository_temporary_error',
      retry_count: 1,
      occurred_at: '2026-09-24T09:05:01.000Z',
    })
    advanceRunPhase(db, 'current-run', 2, '2026-09-24T09:05:02.000Z')

    expect(inspectProgress(db)).toEqual({
      run: {
        runId: 'current-run',
        status: 'running',
        phase: 'enrichment',
        phaseStartedAt: '2026-09-24T08:50:00.000Z',
        phaseTotal: 5,
        phaseProcessed: 2,
        phasePercent: 40,
        startedAt: '2026-09-24T08:34:58.000Z',
        heartbeatAt: '2026-09-24T09:05:02.000Z',
        completedAt: null,
        publishedAt: null,
        warningCount: 0,
        lastError: null,
      },
      repositories: {
        total: 5,
        publishable: 2,
        incomplete: 3,
        invalidIdentity: 0,
        invalidMetrics: 0,
        missingMarketplace: 0,
        updatedThisRun: 1,
        pendingThisRun: 3,
        updatedSinceRunStart: 2,
        enrichedSinceRunStart: 1,
        latestUpdatedAt: '2026-09-24T09:05:00.000Z',
        updatedPercent: 20,
      },
      publication: {
        lastPublishedSize: 3,
        currentPublishableSize: 2,
        delta: -1,
      },
      errors: {
        count: 1,
        latestAt: '2026-09-24T09:05:01.000Z',
      },
    })
    db.close()
  })

  it('does not treat discovery node-id refreshes as enrichment progress', () => {
    const db = openDatabase(databasePath())
    populateFixture(db)
    beginRun(db, 'current-run', '2026-09-24T08:34:58.000Z')
    startRunPhase(db, 'current-run', 'discovery', '2026-09-24T08:35:00.000Z')
    const before = db.prepare('SELECT html_url FROM repositories WHERE id = 1').get() as { html_url: string }
    upsertDiscovery(db, before.html_url, 'rediscovered', '2026-09-24T09:00:00.000Z', 'node-id')

    expect(inspectProgress(db)).toMatchObject({
      run: {
        phase: 'discovery',
        phaseTotal: null,
        phaseProcessed: 0,
        phasePercent: null,
      },
      repositories: {
        updatedThisRun: 0,
        pendingThisRun: null,
        updatedPercent: null,
      },
    })
    db.close()
  })

  it('separates missing marketplace data and invalid canonical identity', () => {
    const db = openDatabase(databasePath())
    populateFixture(db)
    db.prepare('UPDATE repositories SET plugins_count = NULL WHERE id = 1').run()
    db.prepare("UPDATE repositories SET owner_url = 'https://github.com/wrong' WHERE id = 3").run()

    expect(inspectProgress(db)).toMatchObject({
      repositories: {
        total: 5,
        publishable: 1,
        incomplete: 3,
        invalidIdentity: 1,
        invalidMetrics: 0,
        missingMarketplace: 1,
      },
      publication: {
        lastPublishedSize: 3,
        currentPublishableSize: 1,
        delta: -2,
      },
    })
    db.close()
  })

  it('does not classify invalid metrics as invalid identity', () => {
    const db = openDatabase(databasePath())
    populateFixture(db)
    db.prepare('UPDATE repositories SET stargazers_count = -1 WHERE id = 3').run()

    expect(inspectProgress(db)).toMatchObject({
      repositories: {
        total: 5,
        publishable: 1,
        incomplete: 3,
        invalidIdentity: 0,
        invalidMetrics: 1,
      },
    })
    db.close()
  })

  it('does not double-count a repository that fails and later succeeds in the same run', () => {
    const db = openDatabase(databasePath())
    populateFixture(db)
    beginRun(db, 'current-run', '2026-09-24T08:34:58.000Z')
    startRunPhase(db, 'current-run', 'enrichment', '2026-09-24T08:39:00.000Z', 5)
    recordRunError(db, {
      run_id: 'current-run',
      phase: 'enrich',
      repository_id: 1,
      error_type: 'repository_temporary_error',
      retry_count: 1,
      occurred_at: '2026-09-24T08:40:00.000Z',
    })
    db.prepare("UPDATE repositories SET updatedAt = '2026-09-24T09:00:00.000Z' WHERE id = 1").run()
    advanceRunPhase(db, 'current-run', 1, '2026-09-24T09:00:01.000Z')

    expect(inspectProgress(db)).toMatchObject({
      repositories: {
        updatedThisRun: 1,
        pendingThisRun: 4,
      },
    })
    db.close()
  })

  it('exposes progress through a read-only CLI command without GitHub credentials', async () => {
    const path = databasePath()
    const setup = openDatabase(path)
    populateFixture(setup)
    beginRun(setup, 'current-run', '2026-09-24T08:34:58.000Z')
    startRunPhase(setup, 'current-run', 'enrichment', '2026-09-24T08:50:00.000Z', 5)
    setup.prepare("UPDATE repositories SET updatedAt = '2026-09-24T09:00:00.000Z' WHERE id = 1").run()
    advanceRunPhase(setup, 'current-run', 1, '2026-09-24T09:00:01.000Z')
    setup.close()
    const output = vi.fn()

    await runCli(['inspect-progress'], {
      env: { DB_PATH: path },
      output,
    })

    expect(JSON.parse(output.mock.calls[0]?.[0])).toMatchObject({
      run: { runId: 'current-run', status: 'running' },
      repositories: {
        total: 5,
        publishable: 2,
        incomplete: 3,
        invalidIdentity: 0,
        invalidMetrics: 0,
        missingMarketplace: 0,
        updatedThisRun: 1,
        pendingThisRun: 4,
        updatedSinceRunStart: 1,
        enrichedSinceRunStart: 1,
        updatedPercent: 20,
      },
      publication: { lastPublishedSize: 3, currentPublishableSize: 2, delta: -1 },
      errors: { count: 0, latestAt: null },
    })

    const verified = openDatabase(path)
    expect(verified.prepare('SELECT COUNT(*) AS count FROM repositories').get()).toEqual({ count: 5 })
    verified.close()
  })

  it('does not create a missing database while inspecting progress', async () => {
    const path = databasePath()
    expect(existsSync(path)).toBe(false)

    await expect(runCli(['inspect-progress'], { env: { DB_PATH: path } })).rejects.toThrow()
    expect(existsSync(path)).toBe(false)
  })

  it('reports repository and publication state when there are no runs yet', () => {
    const db = openDatabase(databasePath())
    populateFixture(db)
    expect(inspectProgress(db)).toMatchObject({
      run: null,
      repositories: {
        total: 5,
        publishable: 2,
        incomplete: 3,
        invalidIdentity: 0,
        invalidMetrics: 0,
        missingMarketplace: 0,
        updatedThisRun: null,
        pendingThisRun: null,
        updatedSinceRunStart: null,
        enrichedSinceRunStart: null,
        latestUpdatedAt: '2026-01-01T00:00:00.000Z',
        updatedPercent: null,
      },
      publication: {
        lastPublishedSize: 3,
        currentPublishableSize: 2,
        delta: -1,
      },
      errors: null,
    })
    db.close()
  })
})
