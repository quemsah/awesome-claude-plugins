import Database from 'better-sqlite3'
import { afterEach, expect, it, vi } from 'vitest'
import { completeRepositoryHistory } from '../../test/repositorySearchFixture.js'
import { GitHubFatalError, type GitHubReader, type GitHubRepo, GitHubTemporaryError } from '../github/client.js'
import { repositorySearchQueries, repositorySearchQueryVersion } from '../github/repositorySearchQueries.js'
import type { SizeRange } from '../github/sizeRanges.js'
import { replaceCachedDiscoveryRanges } from '../storage/discoveryRanges.js'
import { inspect } from '../storage/inspect.js'
import { upsertDiscovery } from '../storage/repositories.js'
import { ensureRepositorySearchPartition, saveRepositorySearchPartition } from '../storage/repositorySearch.js'
import {
  beginRun,
  claimPublicationLease,
  completeRun,
  failRun,
  getActiveRun,
  getRun,
  listRunErrors,
  recordRunError,
  recoverStaleRun,
  saveRunDraft,
} from '../storage/runs.js'
import { initializeSchema } from '../storage/schema.js'
import { runCrawl as runCrawlImpl, type RunCrawlOptions } from './runCrawl.js'

// Existing integration scenarios explicitly opt into Repository Search.
const runCrawl = (db: Database.Database, reader: GitHubReader, runId: string, options: RunCrawlOptions = {}) =>
  runCrawlImpl(db, reader, runId, { repositorySearchEnabled: true, ...options })

const databases: Database.Database[] = []
const firstRange: SizeRange = [0, 150]
const ranges: SizeRange[] = [firstRange, [150, 200]]
const url = 'https://github.com/team/repo'

function database(): Database.Database {
  const db = new Database(':memory:')
  initializeSchema(db)
  completeRepositoryHistory(db)
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
    searchRepositories: async () => ({ items: [], total_count: 0, incomplete_results: false }),
    searchCode: async () => ({
      items: [{ path: '.claude-plugin/marketplace.json', repository: { html_url: url, description: 'from search' } }],
      total_count: 1,
      incomplete_results: false,
    }),
    getRepository: async (owner, name) => ({ kind: 'found', data: repo(owner, name) }),
    getMarketplace: async () => ({ kind: 'found', data: { plugins: [1] } }),
    ...overrides,
  }
}

it('does not call Repository Search without explicit opt-in', async () => {
  const db = database()
  const client = reader({
    searchRepositories: async () => {
      throw new Error('Optional search must stay disabled')
    },
  })
  const result = await runCrawlImpl(db, client, 'disabled-repo-search', { ranges: [firstRange] })
  expect(result.discovery.sources.repo_search.state).toBe('not_due')
  expect(result.status).toBe('completed')
})

it('isolates an optional Repository Search API error from healthy Code Search', async () => {
  const db = database()
  const client = reader({
    searchRepositories: async () => {
      throw new GitHubFatalError('invalid repository search', 422)
    },
  })
  const result = await runCrawl(db, client, 'optional-search-error', { ranges: [firstRange] })
  expect(result.discovery.sources.repo_search.state).toBe('incomplete')
  expect(result.discovery.sources.repo_search.warnings).toContain('optional-source-error')
  expect(result.discovery.successfulRanges).toBeGreaterThan(0)
  expect(result.status).toBe('completed')
})

it('runs discovery before enrichment and completes with a typed report and stored error counts', async () => {
  const db = database()
  let time = Date.parse('2026-09-23T00:00:00Z')
  const events: string[] = []
  const client = reader({
    searchCode: async (query) => {
      expect(getActiveRun(db)?.run_id).toBe('success')
      events.push(`search:${query.slice(-6)}`)
      time += 60_000
      return {
        items: [{ path: '.claude-plugin/marketplace.json', repository: { html_url: url, description: 'search' } }],
        total_count: 1,
        incomplete_results: false,
      }
    },
    getRepository: async (owner, name) => {
      events.push('repository')
      expect(getRun(db, 'success')?.heartbeat_at).toBe('2026-09-23T00:04:00.000Z')
      return { kind: 'found', data: repo(owner, name) }
    },
    getMarketplace: async () => {
      events.push('marketplace')
      time += 30_000
      return { kind: 'found', data: { plugins: [1] } }
    },
  })

  const result = await runCrawl(db, client, 'success', { ranges, now: () => new Date(time) })

  expect(events).toEqual(['search:0..150', 'search:0..200', 'search:0..150', 'search:0..200', 'repository', 'marketplace'])
  expect(result).toMatchObject({
    runId: 'success',
    status: 'completed',
    discovery: { newUrls: 1, existingUrls: 0, successfulRanges: 4, warningCount: 0 },
    enrichment: { newReady: 1, updated: 0, deleted404: 0, conclusive: 1 },
    warningCount: 0,
    errorCategories: {},
  })
  expect(getRun(db, 'success')).toMatchObject({
    status: 'completed',
    started_at: '2026-09-23T00:00:00.000Z',
    heartbeat_at: '2026-09-23T00:04:30.000Z',
    completed_at: '2026-09-23T00:04:30.000Z',
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

it('logs per-family outcomes and enriches stored and newly discovered repositories after all searches', async () => {
  const db = database()
  const existingUrl = 'https://github.com/existing/repo'
  const discoveredUrl = 'https://github.com/new/repo'
  upsertDiscovery(db, existingUrl, null)
  const events: string[] = []
  const log = vi.fn()
  const client = reader({
    searchCode: async (query) => {
      events.push(`search:${query}`)
      if (query.startsWith('filename:'))
        return {
          items: [{ path: '.claude-plugin/marketplace.json', repository: { html_url: discoveredUrl, description: 'found' } }],
          total_count: 1,
          incomplete_results: false,
        }
      if (query.startsWith('.claude-plugin/')) throw new GitHubTemporaryError('temporary outage', 503)
      return {
        items: [{ path: '.claude-plugin/marketplace.json', repository: { html_url: discoveredUrl, description: 'duplicate' } }],
        total_count: 1,
        incomplete_results: false,
      }
    },
    getRepository: async (owner, name) => {
      events.push(`repository:${owner}/${name}`)
      return { kind: 'found', data: repo(owner, name) }
    },
  })

  const result = await runCrawl(db, client, 'family-outcomes', { ranges: [[0, 10]], log })

  expect(events.slice(0, 2)).toEqual([
    'search:filename:marketplace.json path:.claude-plugin size:0..10',
    'search:.claude-plugin/marketplace.json in:path size:0..10',
  ])
  expect(events.slice(2)).toEqual(['repository:existing/repo', 'repository:new/repo'])
  expect(result.discovery).toMatchObject({
    newUrls: 1,
    successfulRanges: 1,
    warningCount: 1,
    families: {
      marketplace_filename_path: { successfulRanges: 1, warningCount: 0 },
      marketplace_path_literal: { successfulRanges: 0, warningCount: 1 },
    },
  })
  expect(result.enrichment.conclusive).toBe(2)
  expect(listRunErrors(db, 'family-outcomes')).toContainEqual(
    expect.objectContaining({ phase: 'search', query_family: 'marketplace_path_literal', error_type: 'temporary-error' }),
  )
  expect(log).toHaveBeenCalledWith(
    expect.objectContaining({
      event: 'crawl.phase_completed',
      phase: 'discovery',
      families: result.discovery.families,
    }),
  )
})

it('logs the fatal family and skips enrichment when the literal marketplace query receives HTTP 422', async () => {
  const db = database()
  const getRepository = vi.fn()
  const getMarketplace = vi.fn()
  const log = vi.fn()
  const client = reader({
    searchCode: async (query) => {
      if (query.startsWith('.claude-plugin/')) throw new GitHubFatalError('Code Search rejected the query', 422)
      return { items: [], total_count: 0, incomplete_results: false }
    },
    getRepository,
    getMarketplace,
  })

  await expect(runCrawl(db, client, 'family-fatal', { ranges: [[0, 10]], log })).rejects.toMatchObject({
    category: 'github_fatal_error',
  })

  expect(listRunErrors(db, 'family-fatal').some(({ phase }) => phase === 'enrich')).toBe(false)
  expect(getRepository).not.toHaveBeenCalled()
  expect(getMarketplace).not.toHaveBeenCalled()
  expect(log).toHaveBeenCalledWith(
    expect.objectContaining({
      event: 'crawl.request_failed',
      query_family: 'marketplace_path_literal',
      status: 422,
    }),
  )
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

it('fails rather than completing when both discovery sources fail, even if enrichment confirms an existing row', async () => {
  const db = database()
  upsertDiscovery(db, url, 'old')
  const client = reader({
    searchCode: async () => {
      throw new GitHubTemporaryError('network outage', 503)
    },
    searchRepositories: async () => {
      throw new GitHubTemporaryError('network outage', 503)
    },
  })

  await expect(runCrawl(db, client, 'no-search', { ranges })).rejects.toMatchObject({ category: 'no_successful_ranges' })

  expect(db.prepare('SELECT owner FROM repositories WHERE html_url = ?').get(url)).toEqual({ owner: 'team' })
  expect(getRun(db, 'no-search')).toMatchObject({ status: 'failed', last_error: 'no_successful_ranges', published_at: null })
  const errors = listRunErrors(db, 'no-search')
  expect(errors.filter(({ phase }) => phase === 'search')).toHaveLength(4)
  expect(errors.at(-1)).toMatchObject({ phase: 'crawl', error_type: 'no_successful_ranges' })
})

it('completes from Repository Search when every Code Search range fails', async () => {
  const db = database()
  const repoSearchUrl = 'https://github.com/team/repo-search-only'
  const client = reader({
    searchCode: async () => {
      throw new GitHubTemporaryError('network outage', 503)
    },
    searchRepositories: async (query) =>
      query.startsWith('topic:claude-plugin is:public pushed:')
        ? {
            items: [
              {
                html_url: repoSearchUrl,
                description: 'independent discovery candidate',
                node_id: 'repo-search-node',
                private: false,
              },
            ],
            total_count: 1,
            incomplete_results: false,
          }
        : { items: [], total_count: 0, incomplete_results: false },
  })

  const result = await runCrawl(db, client, 'repo-search-only', { ranges: [firstRange] })

  expect(result.discovery.successfulRanges).toBe(0)
  expect(result.discovery.sources.repo_search.uniqueCandidates).toBe(1)
  expect(result.enrichment.conclusive).toBe(1)
  expect(result.status).toBe('completed')
  expect(db.prepare('SELECT owner, plugins_count FROM repositories WHERE html_url = ?').get(repoSearchUrl)).toEqual({
    owner: 'team',
    plugins_count: 1,
  })
})

it('completes an empty Repository Search scan when Code Search fails and there is nothing to enrich', async () => {
  const db = database()
  const client = reader({
    searchCode: async () => {
      throw new GitHubTemporaryError('network outage', 503)
    },
    searchRepositories: async () => ({ items: [], total_count: 0, incomplete_results: false }),
  })

  const result = await runCrawl(db, client, 'repo-search-empty', { ranges: [firstRange] })

  expect(result.discovery.successfulRanges).toBe(0)
  expect(result.discovery.sources.repo_search.state).toBe('complete')
  expect(result.enrichment.conclusive).toBe(0)
  expect(result.status).toBe('completed')
  expect(getRun(db, 'repo-search-empty')).toMatchObject({ status: 'completed', last_error: null })
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
      return {
        items: [{ path: '.claude-plugin/marketplace.json', repository: { html_url: url, description: null } }],
        total_count: 1,
        incomplete_results: query.endsWith('0..150'),
      }
    },
    getRepository: async (owner, name) =>
      name === 'transient'
        ? { kind: 'temporary-error', status: 503, reason: 'network', retryCount: 0 }
        : { kind: 'found', data: repo(owner, name) },
  })

  const result = await runCrawl(db, client, 'partial', { ranges })

  expect(result.discovery.successfulRanges).toBe(4)
  expect(result.enrichment).toMatchObject({ newIncomplete: 1, conclusive: 1 })
  expect(result.errorCategories).toEqual({ 'incomplete-results': 2, 'temporary-error': 2, repository_temporary_error: 1 })
  expect(result.warningCount).toBe(5)
  expect(getRun(db, 'partial')).toMatchObject({ status: 'completed', warning_count: 5 })
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
        return {
          items: [{ path: '.claude-plugin/marketplace.json', repository: { html_url: url, description: null } }],
          total_count: 1,
          incomplete_results: false,
        }
      },
    }),
    'category',
    { ranges: [firstRange] },
  )

  expect(result.warningCount).toBe(2)
  expect(result.errorCategories).toEqual({ constructor: 2 })
  expect(getRun(db, 'category')?.warning_count).toBe(2)
})

it('heartbeats throughout enrichment batches without adding reader requests', async () => {
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
  expect(heartbeatAt[0]).toBe('2026-09-23T00:00:01.000Z')
  expect(heartbeatAt[49]).toBe('2026-09-23T00:00:50.000Z')
  expect(heartbeatAt.at(-1)).toBe('2026-09-23T00:00:51.000Z')
  expect(getRun(db, 'batches')?.heartbeat_at).toBe('2026-09-23T00:00:51.000Z')
})

it('marks a SQLite failure during discovery as failed without leaking the raw exception into storage', async () => {
  const db = database()
  const client = reader({
    searchCode: async () => {
      db.exec('DROP TABLE repositories')
      return {
        items: [{ path: '.claude-plugin/marketplace.json', repository: { html_url: url, description: null } }],
        total_count: 1,
        incomplete_results: false,
      }
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

it('prevents a recovered stale crawl from writing after its in-flight request returns', async () => {
  const db = database()
  const staleUrl = 'https://github.com/stale/late-write'
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
        return {
          items: [{ path: '.claude-plugin/marketplace.json', repository: { html_url: staleUrl, description: 'stale' } }],
          total_count: 1,
          incomplete_results: false,
        }
      },
    }),
    'interrupted',
    { ranges: [firstRange], now: () => new Date('2026-09-23T00:00:00.000Z') },
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
    expect(recoverStaleRun(db, '2026-09-23T00:30:00.000Z', '2026-09-23T01:00:00.000Z')).toMatchObject({
      run_id: 'interrupted',
    })
    expect(
      (
        await runCrawl(db, reader(), 'after-crash', {
          ranges: [firstRange],
          now: () => new Date('2026-09-23T01:00:00.000Z'),
        })
      ).status,
    ).toBe('completed')
  } finally {
    resume?.()
  }
  await rejection
  expect(getRun(db, 'interrupted')).toMatchObject({ status: 'failed', last_error: 'stale_run' })
  expect(getRun(db, 'after-crash')?.status).toBe('completed')
  expect(db.prepare('SELECT id FROM repositories WHERE html_url = ?').get(staleUrl)).toBeUndefined()
  expect(db.prepare('SELECT id FROM repositories WHERE html_url = ?').get(url)).toBeDefined()
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
it('marks a shutdown crawl as terminated after the in-flight request and releases the active-run lock', async () => {
  const db = database()
  const shutdown = new AbortController()
  const searchCode = vi.fn(async () => {
    shutdown.abort()
    return { items: [], total_count: 0, incomplete_results: false }
  })

  await expect(
    runCrawl(db, reader({ searchCode }), 'shutdown', {
      ranges,
      signal: shutdown.signal,
      now: () => new Date('2026-09-23T02:00:00.000Z'),
    }),
  ).rejects.toMatchObject({ category: 'terminated' })

  expect(searchCode).toHaveBeenCalledOnce()
  expect(getActiveRun(db)).toBeNull()
  expect(getRun(db, 'shutdown')).toMatchObject({
    status: 'failed',
    last_error: 'terminated',
    completed_at: '2026-09-23T02:00:00.000Z',
  })
  expect(listRunErrors(db, 'shutdown')).toContainEqual(expect.objectContaining({ phase: 'crawl', error_type: 'terminated' }))
})

it('finishes the crawl while reporting bounded incomplete repo coverage and post-enrichment source overlap', async () => {
  const db = database()
  db.exec('DELETE FROM repository_search_partitions')
  const log = vi.fn()
  const order: string[] = []
  const result = await runCrawl(
    db,
    reader({
      searchCode: async () => {
        order.push('code')
        return {
          items: [{ path: '.claude-plugin/marketplace.json', repository: { html_url: url, description: null } }],
          total_count: 1,
          incomplete_results: false,
        }
      },
      searchRepositories: async () => {
        order.push('repo')
        return {
          items: [
            { html_url: url, description: null },
            { html_url: 'https://github.com/team/only-repo', description: null },
            { html_url: 'https://github.com/team/mcp', description: null },
          ],
          total_count: 3,
          incomplete_results: true,
        }
      },
      getMarketplace: async (_owner, name) => {
        order.push('enrich')
        return name === 'mcp' ? { kind: 'not-found' } : { kind: 'found', data: { plugins: [1] } }
      },
    }),
    'bounded',
    { ranges: [[0, 1]], now: () => new Date('2026-10-30T12:00:00Z'), log },
  )
  expect(result.status).toBe('completed')
  expect(order.slice(0, 3)).toEqual(['code', 'code', 'repo'])
  expect(order.indexOf('enrich')).toBeGreaterThan(order.lastIndexOf('repo'))
  expect(result.discovery).toMatchObject({
    coverageScope: 'configured_query_catalog',
    uniqueCandidates: 3,
    uniqueCatalogAdditions: 2,
    sources: {
      code_search: {
        state: 'complete',
        pagesFetched: 2,
        totalResults: 2,
        uniqueCandidates: 1,
        newUrls: 1,
        acceptedMarketplaces: 1,
        rejectedCandidates: 0,
      },
      repo_search: {
        state: 'incomplete',
        pagesFetched: 20,
        totalResults: 60,
        uniqueCandidates: 3,
        newUrls: 2,
        acceptedMarketplaces: 2,
        rejectedCandidates: 1,
        pendingCandidates: 0,
        warnings: expect.arrayContaining(['incomplete-results', 'request-budget']),
      },
    },
  })
  expect(result.warningCount).toBeGreaterThan(0)
  expect(result.errorCategories).not.toHaveProperty('repo_search_incomplete')
  expect(log).toHaveBeenCalledWith(
    expect.objectContaining({
      event: 'crawl.repository_search.partition',
      queryId: repositorySearchQueries[0].queryId,
      queryVersion: repositorySearchQueryVersion,
      partitionKey: 'pushed:2026-10-01..2026-10-30',
      state: 'incomplete',
      reason: 'incomplete-results',
    }),
  )
  expect(log).toHaveBeenCalledWith(
    expect.objectContaining({ event: 'crawl.coverage_warning', source: 'repo_search', category: 'source_incomplete' }),
  )
  expect(JSON.stringify(log.mock.calls)).not.toContain('"items"')
})

it('alerts in structured logs after consecutive incomplete rolling scans and clears the streak after recovery', async () => {
  const db = database()
  const log = vi.fn()
  const options = { ranges: [[0, 1]] as const, now: () => new Date('2026-10-30T12:00:00Z'), log }
  const partial = reader({ searchRepositories: async () => ({ items: [], total_count: 0, incomplete_results: true }) })
  await runCrawl(db, partial, 'partial-1', options)
  expect(log.mock.calls.some(([event]) => event.event === 'crawl.coverage_alert')).toBe(false)
  await runCrawl(db, partial, 'partial-2', options)
  expect(log).toHaveBeenCalledWith(
    expect.objectContaining({ event: 'crawl.coverage_alert', category: 'rolling_partition_repeatedly_incomplete', consecutiveCrawls: 2 }),
  )
  await runCrawl(db, reader(), 'recovered', options)
  expect(
    JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'discovery_source_repo_search'").get() as { value: string }).value),
  ).toMatchObject({ state: 'complete', rollingIncompleteStreak: 0 })
})

it('marks a saturated Code Search leaf incomplete even when GitHub returns all accessible results', async () => {
  const db = database()
  const result = await runCrawl(
    db,
    reader({
      searchCode: async () => ({
        items: Array.from({ length: 100 }, () => ({
          path: '.claude-plugin/marketplace.json',
          repository: { html_url: url, description: null },
        })),
        total_count: 1000,
        incomplete_results: false,
      }),
    }),
    'saturated-code',
    { ranges: [[0, 0]], now: () => new Date('2026-10-30T12:00:00Z') },
  )
  expect(result.discovery.sources.code_search).toMatchObject({ state: 'incomplete', incompletePartitions: 2, saturatedPartitions: 2 })
})

it('counts each incomplete Code Search leaf separately when cached partitions fail', async () => {
  const db = database()
  replaceCachedDiscoveryRanges(
    db,
    'marketplace_filename_path',
    [0, 1],
    [
      [0, 0],
      [1, 1],
    ],
  )
  const result = await runCrawl(
    db,
    reader({
      searchCode: async (query) => {
        if (query.startsWith('filename:')) throw new GitHubTemporaryError('temporary', 503)
        return {
          items: [{ path: '.claude-plugin/marketplace.json', repository: { html_url: url, description: null } }],
          total_count: 1,
          incomplete_results: false,
        }
      },
    }),
    'cached-leaves',
    { ranges: [[0, 1]], now: () => new Date('2026-10-30T12:00:00Z') },
  )
  expect(result.discovery.sources.code_search).toMatchObject({ state: 'incomplete', partitions: 3, incompletePartitions: 2 })
})

it('does not count an existing accepted canonical marketplace as an addition when a merge changes its row id', async () => {
  const db = database()
  const oldId = upsertDiscovery(db, url, null)
  const canonical = 'https://github.com/team/canonical'
  const existingId = upsertDiscovery(db, canonical, null)
  db.prepare('UPDATE repositories SET plugins_count = 1 WHERE id = ?').run(existingId)
  const result = await runCrawl(
    db,
    reader({ getRepository: async () => ({ kind: 'found', data: repo('team', 'canonical') }) }),
    'merged-additions',
    { ranges: [[0, 1]], now: () => new Date('2026-10-30T12:00:00Z') },
  )
  expect(db.prepare('SELECT id FROM repositories WHERE html_url = ?').get(canonical)).toEqual({ id: oldId })
  expect(result.discovery.sources.code_search.acceptedMarketplaces).toBe(1)
  expect(result.discovery.uniqueCatalogAdditions).toBe(0)
})

it.each(['code_search', 'repo_search'] as const)(
  'persists %s fatal attempts independently after a previously complete scan',
  async (source) => {
    const db = database()
    const first = new Date('2026-10-30T12:00:00Z')
    const failedAt = new Date('2026-10-30T13:00:00Z')
    await runCrawl(db, reader(), 'complete-before-fatal', { ranges: [[0, 1]], now: () => first })
    const client = reader(
      source === 'code_search'
        ? {
            searchCode: async () => {
              throw new GitHubFatalError('fatal code', 422)
            },
          }
        : {
            searchRepositories: async () => {
              throw new GitHubFatalError('fatal repo', 422)
            },
          },
    )
    await expect(runCrawl(db, client, 'fatal-source', { ranges: [[0, 1]], now: () => failedAt })).rejects.toMatchObject({
      category: 'github_fatal_error',
    })
    const coverage = inspect(db, failedAt)
    expect(coverage.sources[source]).toMatchObject({
      freshness: 'incomplete',
      due: true,
      lastAttempt: failedAt.toISOString(),
      lastCompleteScan: first.toISOString(),
      incompletePartitions: expect.any(Number),
    })
    expect(coverage.sources[source].incompletePartitions).toBeGreaterThan(0)
    if (source === 'repo_search')
      expect(coverage.sources.code_search).toMatchObject({ freshness: 'fresh', lastCompleteScan: failedAt.toISOString() })
    else expect(coverage.sources.repo_search.lastAttempt).toBe(first.toISOString())
  },
)

it('persists consecutive fatal rolling attempts and alerts before propagating the second failure', async () => {
  const db = database()
  const log = vi.fn()
  const options = { ranges: [[0, 1]] as const, now: () => new Date('2026-10-30T12:00:00Z'), log }
  await runCrawl(db, reader(), 'fatal-rolling-baseline', options)
  const client = reader({
    searchRepositories: async () => {
      throw new GitHubFatalError('query rejected', 422)
    },
  })
  for (let attempt = 1; attempt <= 2; attempt++) {
    await expect(runCrawl(db, client, `fatal-rolling-${attempt}`, options)).rejects.toMatchObject({ category: 'github_fatal_error' })
    expect(inspect(db, options.now()).sources.repo_search).toMatchObject({ freshness: 'incomplete', rollingIncompleteStreak: attempt })
  }
  expect(log).toHaveBeenCalledWith(
    expect.objectContaining({
      event: 'crawl.coverage_alert',
      category: 'rolling_partition_repeatedly_incomplete',
      runId: 'fatal-rolling-2',
      consecutiveCrawls: 2,
    }),
  )
  expect(inspect(db, options.now()).sources.repo_search.alerts).toContain('rolling_partition_repeatedly_incomplete')
})

it('alerts on the same unresolved historical leaf across invocations while rolling scans succeed and clears it after recovery', async () => {
  const db = database()
  const historical = ensureRepositorySearchPartition(db, 'metadata_plugin', { field: 'created', start: '2008-01-01', end: '2008-12-31' })
  historical.status = 'incomplete'
  historical.last_completed_at = null
  saveRepositorySearchPartition(db, historical)
  const log = vi.fn()
  let at = new Date('2026-10-30T12:00:00Z')
  const options = { ranges: [[0, 1]] as const, now: () => at, log }
  const client = reader({
    searchRepositories: async (query) => ({ items: [], total_count: 0, incomplete_results: query.includes('created:') }),
  })
  await runCrawl(db, client, 'historical-first', options)
  expect(inspect(db, at).sources.repo_search.alerts).not.toContain('partition_repeatedly_incomplete')
  at = new Date('2026-10-31T12:00:00Z')
  await runCrawl(db, client, 'historical-again', options)
  expect(log).toHaveBeenCalledWith(
    expect.objectContaining({
      event: 'crawl.coverage_alert',
      category: 'partition_repeatedly_incomplete',
      runId: 'historical-again',
      partitions: [{ queryId: 'metadata_plugin', partitionKey: historical.partition_key }],
    }),
  )
  expect(inspect(db, at).sources.repo_search).toMatchObject({
    rollingIncompleteStreak: 0,
    alerts: ['partition_repeatedly_incomplete'],
    repeatedIncompletePartitions: [{ queryId: 'metadata_plugin', partitionKey: historical.partition_key }],
  })
  await runCrawl(db, reader(), 'historical-recovered', options)
  expect(inspect(db, at).sources.repo_search).toMatchObject({ freshness: 'fresh', alerts: [], repeatedIncompletePartitions: [] })
})

it('retains alerts for historical due leaves skipped by the request budget despite old complete checkpoints', async () => {
  const db = database()
  db.prepare("UPDATE repository_search_partitions SET last_completed_at = '2026-01-01T00:00:00Z'").run()
  const log = vi.fn()
  const at = new Date('2026-10-30T12:00:00Z')
  const options = { ranges: [[0, 1]] as const, now: () => at, log }
  await runCrawl(db, reader(), 'budget-history-first', options)
  await runCrawl(db, reader(), 'budget-history-again', options)
  const expected = { queryId: 'topic_claude_code_plugin', partitionKey: 'created:2026-01-01..2026-12-31' }
  expect(
    db
      .prepare('SELECT status FROM repository_search_partitions WHERE query_id = ? AND partition_key = ?')
      .get(expected.queryId, expected.partitionKey),
  ).toEqual({ status: 'complete' })
  expect(inspect(db, at).sources.repo_search).toMatchObject({
    freshness: 'incomplete',
    rollingIncompleteStreak: 0,
    alerts: ['partition_repeatedly_incomplete'],
    repeatedIncompletePartitions: expect.arrayContaining([expected]),
  })
  expect(log).toHaveBeenCalledWith(
    expect.objectContaining({
      event: 'crawl.coverage_alert',
      category: 'partition_repeatedly_incomplete',
      runId: 'budget-history-again',
      partitions: expect.arrayContaining([expected]),
    }),
  )
})
