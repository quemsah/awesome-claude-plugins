import Database from 'better-sqlite3'
import { afterEach, expect, it } from 'vitest'
import { GitHubFatalError, type GitHubReader, type GitHubRepo, GitHubTemporaryError } from '../github/client.js'
import type { SizeRange } from '../github/sizeRanges.js'
import { upsertDiscovery } from '../storage/repositories.js'
import {
  beginRun,
  claimPublicationLease,
  completeRun,
  failRun,
  getActiveRun,
  getRun,
  listRunErrors,
  recordRunError,
  saveRunDraft,
} from '../storage/runs.js'
import { initializeSchema } from '../storage/schema.js'
import { runCrawl } from './runCrawl.js'

const databases: Database.Database[] = []
const firstRange: SizeRange = [0, 150]
const ranges: SizeRange[] = [firstRange, [150, 200]]
const url = 'https://github.com/team/repo'

function database(): Database.Database {
  const db = new Database(':memory:')
  initializeSchema(db)
  databases.push(db)
  return db
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})

function repo(owner: string, name: string): GitHubRepo {
  return {
    html_url: `https://github.com/${owner}/${name}`,
    name,
    owner: { login: owner, html_url: `https://github.com/${owner}` },
    description: 'from REST',
    stargazers_count: 4,
    forks_count: 2,
    subscribers_count: 1,
    pushed_at: '2026-09-22T12:00:00Z',
  }
}

function reader(overrides: Partial<GitHubReader> = {}): GitHubReader {
  return {
    searchCode: async () => ({
      items: [{ repository: { html_url: url, description: 'from search' } }],
      total_count: 1,
      incomplete_results: false,
    }),
    getRepository: async (owner, name) => ({ kind: 'found', data: repo(owner, name) }),
    getMarketplace: async () => ({ kind: 'found', data: { plugins: [1] } }),
    ...overrides,
  }
}

it('runs discovery before enrichment and completes with a typed report and stored error counts', async () => {
  const db = database()
  let time = Date.parse('2026-09-23T00:00:00Z')
  const events: string[] = []
  const client = reader({
    searchCode: async (query) => {
      expect(getActiveRun(db)?.run_id).toBe('success')
      events.push(`search:${query.slice(-6)}`)
      time += 60_000
      return { items: [{ repository: { html_url: url, description: 'search' } }], total_count: 1, incomplete_results: false }
    },
    getRepository: async (owner, name) => {
      events.push('repository')
      expect(getRun(db, 'success')?.heartbeat_at).toBe('2026-09-23T00:02:00.000Z')
      return { kind: 'found', data: repo(owner, name) }
    },
    getMarketplace: async () => {
      events.push('marketplace')
      time += 30_000
      return { kind: 'found', data: { plugins: [1] } }
    },
  })

  const result = await runCrawl(db, client, 'success', { ranges, now: () => new Date(time) })

  expect(events).toEqual(['search:0..150', 'search:0..200', 'repository', 'marketplace'])
  expect(result).toMatchObject({
    runId: 'success',
    status: 'completed',
    discovery: { newUrls: 1, existingUrls: 1, successfulRanges: 2, warningCount: 0 },
    enrichment: { newReady: 1, updated: 0, deleted404: 0, conclusive: 1 },
    warningCount: 0,
    errorCategories: {},
  })
  expect(getRun(db, 'success')).toMatchObject({
    status: 'completed',
    started_at: '2026-09-23T00:00:00.000Z',
    heartbeat_at: '2026-09-23T00:02:30.000Z',
    completed_at: '2026-09-23T00:02:30.000Z',
    warning_count: 0,
    published_at: null,
    commit_sha: null,
  })
  expect(db.prepare('SELECT owner, plugins_count FROM repositories WHERE html_url = ?').get(url)).toEqual({
    owner: 'team',
    plugins_count: 1,
  })
  expect(db.prepare('SELECT COUNT(*) AS count FROM stats').get()).toEqual({ count: 0 })
})

it('reports a pending publication as an explicit lock instead of treating it as a database failure', async () => {
  const db = database()
  beginRun(db, 'old', '2026-09-20T00:00:00.000Z')
  completeRun(db, 'old', '2026-09-20T01:00:00.000Z', 0)
  saveRunDraft(db, 'old', { id: 1, date: '2026-09-20T01:00:00.000Z', size: 1, hash: 'a'.repeat(64) })
  claimPublicationLease(db, 'old', 'owner')
  await expect(runCrawl(db, reader(), 'new', { ranges: [firstRange] })).rejects.toMatchObject({ category: 'publication_locked' })
  expect(getRun(db, 'new')).toBeNull()
})

it('fails rather than completing when every search range fails, even if enrichment confirms an existing row', async () => {
  const db = database()
  upsertDiscovery(db, url, 'old')
  const client = reader({
    searchCode: async () => {
      throw new GitHubTemporaryError('network outage', 503)
    },
  })

  await expect(runCrawl(db, client, 'no-search', { ranges })).rejects.toMatchObject({ category: 'no_successful_ranges' })

  expect(db.prepare('SELECT owner FROM repositories WHERE html_url = ?').get(url)).toEqual({ owner: 'team' })
  expect(getRun(db, 'no-search')).toMatchObject({ status: 'failed', last_error: 'no_successful_ranges', published_at: null })
  expect(listRunErrors(db, 'no-search').map(({ phase, error_type }) => ({ phase, error_type }))).toEqual([
    { phase: 'search', error_type: 'temporary-error' },
    { phase: 'search', error_type: 'temporary-error' },
    { phase: 'crawl', error_type: 'no_successful_ranges' },
  ])
})

it('fails when search succeeds but every marketplace result is transient', async () => {
  const db = database()
  const client = reader({
    getMarketplace: async () => ({ kind: 'temporary-error', status: 429, reason: 'rate limited', retryCount: 0 }),
  })

  await expect(runCrawl(db, client, 'no-conclusive', { ranges: [firstRange] })).rejects.toMatchObject({
    category: 'no_conclusive_enrichment',
  })

  expect(getRun(db, 'no-conclusive')).toMatchObject({ status: 'failed', last_error: 'no_conclusive_enrichment' })
  expect(listRunErrors(db, 'no-conclusive').map(({ error_type }) => error_type)).toEqual([
    'marketplace_rate_limited',
    'no_conclusive_enrichment',
  ])
})

it('treats a confirmed 404 as conclusive and reports the removal', async () => {
  const db = database()
  upsertDiscovery(db, url, 'old')
  const result = await runCrawl(db, reader({ getRepository: async () => ({ kind: 'not-found' }) }), 'gone', {
    ranges: [firstRange],
  })

  expect(result.enrichment).toMatchObject({ deleted404: 1, conclusive: 1, newReady: 0 })
  expect(result.status).toBe('completed')
  expect(db.prepare('SELECT id FROM repositories WHERE html_url = ?').get(url)).toBeUndefined()
})

it('completes with warnings from stored search and enrichment errors, including incomplete ranges', async () => {
  const db = database()
  upsertDiscovery(db, 'https://github.com/team/transient', null)
  const client = reader({
    searchCode: async (query) => {
      if (query.endsWith('150..200')) throw new GitHubTemporaryError('outage', null)
      return { items: [{ repository: { html_url: url, description: null } }], total_count: 1, incomplete_results: true }
    },
    getRepository: async (owner, name) =>
      name === 'transient' ? { kind: 'temporary-error', status: 503, reason: 'network', retryCount: 0 } : { kind: 'found', data: repo(owner, name) },
  })

  const result = await runCrawl(db, client, 'partial', { ranges })

  expect(result.discovery.successfulRanges).toBe(1)
  expect(result.enrichment).toMatchObject({ newIncomplete: 1, conclusive: 1 })
  expect(result.errorCategories).toEqual({ 'incomplete-results': 1, 'temporary-error': 1, repository_temporary_error: 1 })
  expect(result.warningCount).toBe(3)
  expect(getRun(db, 'partial')).toMatchObject({ status: 'completed', warning_count: 3 })
})

it('counts any valid persisted error category without inheriting object properties', async () => {
  const db = database()
  const result = await runCrawl(
    db,
    reader({
      searchCode: async () => {
        recordRunError(db, {
          run_id: 'category',
          phase: 'search',
          error_type: 'constructor',
          retry_count: 0,
          occurred_at: '2026-09-23T00:00:00Z',
        })
        return { items: [{ repository: { html_url: url, description: null } }], total_count: 1, incomplete_results: false }
      },
    }),
    'category',
    { ranges: [firstRange] },
  )

  expect(result.warningCount).toBe(1)
  expect(result.errorCategories).toEqual({ constructor: 1 })
  expect(getRun(db, 'category')?.warning_count).toBe(1)
})

it('heartbeats after each 50-row enrichment batch without adding reader requests', async () => {
  const db = database()
  for (let i = 0; i < 51; i++) upsertDiscovery(db, `https://github.com/team/repo${i}`, null)
  let time = Date.parse('2026-09-23T00:00:00Z')
  const heartbeatAt: string[] = []
  const client = reader({
    searchCode: async () => ({ items: [], total_count: 0, incomplete_results: false }),
    getRepository: async (owner, name) => {
      time += 1_000
      return { kind: 'found', data: repo(owner, name) }
    },
    getMarketplace: async () => {
      const heartbeat = getRun(db, 'batches')?.heartbeat_at
      if (heartbeat && heartbeatAt.at(-1) !== heartbeat) heartbeatAt.push(heartbeat)
      return { kind: 'found', data: { plugins: [] } }
    },
  })

  const result = await runCrawl(db, client, 'batches', { ranges: [firstRange], now: () => new Date(time) })

  expect(result.enrichment.conclusive).toBe(51)
  expect(heartbeatAt).toEqual(['2026-09-23T00:00:00.000Z', '2026-09-23T00:00:50.000Z'])
  expect(getRun(db, 'batches')?.heartbeat_at).toBe('2026-09-23T00:00:51.000Z')
})

it('marks a SQLite failure during discovery as failed without leaking the raw exception into storage', async () => {
  const db = database()
  const client = reader({
    searchCode: async () => {
      db.exec('DROP TABLE repositories')
      return { items: [{ repository: { html_url: url, description: null } }], total_count: 1, incomplete_results: false }
    },
  })

  await expect(runCrawl(db, client, 'sqlite', { ranges: [firstRange] })).rejects.toMatchObject({
    category: 'database_error',
  })
  expect(getRun(db, 'sqlite')).toMatchObject({ status: 'failed', last_error: 'database_error' })
  expect(listRunErrors(db, 'sqlite').map(({ phase, error_type }) => ({ phase, error_type }))).toEqual([
    { phase: 'crawl', error_type: 'database_error' },
  ])
})

it('reports a startup database failure explicitly when there is no run row to fail', async () => {
  const db = database()
  db.exec('DROP TABLE runs')

  await expect(runCrawl(db, reader(), 'no-table', { ranges: [firstRange] })).rejects.toMatchObject({
    category: 'database_error',
  })
})

it('records a safe fatal category without persisting credentials and does not enrich after a fatal search error', async () => {
  const db = database()
  const credential = 'super-secret-token'
  const client = reader({
    searchCode: async () => {
      throw new GitHubFatalError(`Authorization: ${credential}`, 401)
    },
    getRepository: async () => {
      throw new Error('enrichment must not start')
    },
  })

  await expect(runCrawl(db, client, 'fatal', { ranges })).rejects.toMatchObject({ category: 'github_fatal_error' })

  expect(getRun(db, 'fatal')).toMatchObject({ status: 'failed', last_error: 'github_fatal_error' })
  expect(listRunErrors(db, 'fatal').map(({ phase, error_type }) => ({ phase, error_type }))).toEqual([
    { phase: 'crawl', error_type: 'github_fatal_error' },
  ])
  expect(JSON.stringify({ run: getRun(db, 'fatal'), errors: listRunErrors(db, 'fatal') })).not.toContain(credential)
})

it('also treats an authentication error mislabeled temporary by a reader as fatal', async () => {
  const db = database()
  const client = reader({
    searchCode: async () => {
      throw new GitHubTemporaryError('credential error', 401)
    },
  })

  await expect(runCrawl(db, client, 'bad-auth', { ranges })).rejects.toMatchObject({ category: 'github_fatal_error' })
  expect(getRun(db, 'bad-auth')).toMatchObject({ status: 'failed', last_error: 'github_fatal_error' })
})

it('keeps an interrupted run active until explicitly recovered and never completes it after recovery', async () => {
  const db = database()
  let resume: (() => void) | undefined
  const waiting = new Promise<void>((resolve) => {
    resume = resolve
  })
  let started: (() => void) | undefined
  const reached = new Promise<void>((resolve) => {
    started = resolve
  })
  const pending = runCrawl(
    db,
    reader({
      searchCode: async () => {
        started?.()
        await waiting
        return { items: [], total_count: 0, incomplete_results: false }
      },
    }),
    'interrupted',
    { ranges: [firstRange] },
  )
  const rejection = pending.then(
    () => {
      throw new Error('Interrupted run must not complete')
    },
    (error: unknown) => {
      expect(error).toMatchObject({ category: 'run_not_active' })
    },
  )
  await reached
  try {
    expect(getActiveRun(db)?.run_id).toBe('interrupted')
    expect(getRun(db, 'interrupted')?.completed_at).toBeNull()
    expect(failRun(db, 'interrupted', '2026-09-23T01:00:00Z', 'stale-heartbeat')).toBe(true)
    expect((await runCrawl(db, reader(), 'after-crash', { ranges: [firstRange] })).status).toBe('completed')
  } finally {
    resume?.()
  }
  await rejection
  expect(getRun(db, 'interrupted')).toMatchObject({ status: 'failed', last_error: 'stale-heartbeat' })
  expect(getRun(db, 'after-crash')?.status).toBe('completed')
})

it('reports run_not_active when operator recovery wins a concurrent failure', async () => {
  const db = database()
  let release: (() => void) | undefined
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  let started: (() => void) | undefined
  const reached = new Promise<void>((resolve) => {
    started = resolve
  })
  const pending = runCrawl(
    db,
    reader({
      searchCode: async () => {
        started?.()
        await waiting
        throw new GitHubFatalError('unauthorized', 401)
      },
    }),
    'recovered-during-failure',
    { ranges: [firstRange] },
  )

  await reached
  expect(failRun(db, 'recovered-during-failure', '2026-09-23T01:00:00Z', 'operator_recovery')).toBe(true)
  release?.()

  await expect(pending).rejects.toMatchObject({ category: 'run_not_active' })
  expect(getRun(db, 'recovered-during-failure')).toMatchObject({
    status: 'failed',
    last_error: 'operator_recovery',
    completed_at: '2026-09-23T01:00:00Z',
  })
})

it('refuses overlapping runs and allows retry with another id after the first fails', async () => {
  const db = database()
  let release: (() => void) | undefined
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  let started: (() => void) | undefined
  const reached = new Promise<void>((resolve) => {
    started = resolve
  })
  const first = runCrawl(
    db,
    reader({
      searchCode: async () => {
        started?.()
        await waiting
        throw new GitHubFatalError('unauthorized', 401)
      },
    }),
    'first',
    { ranges: [firstRange] },
  )
  const rejection = first.then(
    () => {
      throw new Error('Fatal run must not complete')
    },
    (error: unknown) => {
      expect(error).toMatchObject({ category: 'github_fatal_error' })
    },
  )
  await reached
  try {
    await expect(runCrawl(db, reader(), 'overlap', { ranges: [firstRange] })).rejects.toMatchObject({ category: 'run_already_active' })
    expect(getRun(db, 'overlap')).toBeNull()
    expect(getActiveRun(db)?.run_id).toBe('first')
  } finally {
    release?.()
  }
  await rejection
  expect((await runCrawl(db, reader(), 'retry', { ranges: [firstRange] })).status).toBe('completed')
  expect(getRun(db, 'retry')?.status).toBe('completed')
})
