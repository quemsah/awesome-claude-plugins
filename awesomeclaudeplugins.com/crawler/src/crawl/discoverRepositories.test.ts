import Database from 'better-sqlite3'
import { afterEach, expect, it } from 'vitest'
import { GitHubClient, GitHubFatalError, type GitHubReader, GitHubTemporaryError, type RepositorySearchPage } from '../github/client.js'
import {
  historicalWindows,
  repositorySearchQueries,
  repositorySearchQueryVersion,
  rollingPushedWindow,
  splitDateWindow,
} from '../github/repositorySearchQueries.js'
import { ensureRepositorySearchPartition, saveRepositorySearchPartition } from '../storage/repositorySearch.js'
import { beginRun, completeRun } from '../storage/runs.js'
import { recordRejectedCandidate } from '../storage/rejectedCandidates.js'
import { initializeSchema } from '../storage/schema.js'
import { discoverRepositories } from './discoverRepositories.js'

const databases: Database.Database[] = []
const at = '2026-10-30T12:00:00Z'
const firstQuery = repositorySearchQueries[0]
const firstPushed = `${firstQuery.queryText} pushed:2026-10-01..2026-10-30`
const firstCreated = `${firstQuery.queryText} created:2008-01-01..2008-12-31`

function database() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  initializeSchema(db)
  beginRun(db, 'run', at)
  databases.push(db)
  return db
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})

function item(name: string, extra: Partial<RepositorySearchPage['items'][number]> = {}) {
  return { html_url: `https://github.com/example/${name}`, description: name, node_id: `node-${name}`, private: false, ...extra }
}

function page(items: RepositorySearchPage['items'] = [], total_count = items.length, incomplete_results = false): RepositorySearchPage {
  return { items, total_count, incomplete_results }
}

function reader(searchRepositories: GitHubReader['searchRepositories']): GitHubReader {
  return {
    searchRepositories,
    searchCode: async () => {
      throw new Error('unexpected Code Search')
    },
    getRepository: async () => {
      throw new Error('discovery must not enrich')
    },
    getMarketplace: async () => {
      throw new Error('discovery must not fetch marketplaces')
    },
  }
}

function checkpoint(db: Database.Database, queryId = firstQuery.queryId, key = 'pushed:2026-10-01..2026-10-30') {
  return db
    .prepare('SELECT * FROM repository_search_partitions WHERE query_version = ? AND query_id = ? AND partition_key = ?')
    .get(repositorySearchQueryVersion, queryId, key)
}

it('prioritizes pushed work, paginates, and deduplicates public candidates across query families', async () => {
  const db = database()
  const calls: Array<[string, number]> = []
  const result = await discoverRepositories(
    db,
    reader(async (query, number) => {
      calls.push([query, number])
      if (query === firstPushed) {
        if (number === 1)
          return page(
            Array.from({ length: 100 }, () => item('catalog')),
            101,
          )
        expect(number).toBe(2)
        return page([item('another')], 101)
      }
      if (query === 'claude marketplace in:name,description,topics is:public pushed:2026-10-01..2026-10-30') {
        return page([item('CATALOG'), item('private', { private: true }), item('bad', { html_url: 'https://evil.test/example/bad' })])
      }
      return page()
    }),
    'run',
    undefined,
    () => at,
  )

  expect(calls.slice(0, 2)).toEqual([
    [firstPushed, 1],
    [firstPushed, 2],
  ])
  expect(calls.findIndex(([query]) => query === firstCreated)).toBe(repositorySearchQueries.length + 1)
  expect(calls).toHaveLength(20)
  expect(result).toMatchObject({ pagesFetched: 20, uniqueCandidates: 2, newUrls: 2, existingUrls: 0, state: 'incomplete' })
  expect(db.prepare('SELECT html_url, plugins_count FROM repositories ORDER BY id').all()).toEqual([
    { html_url: 'https://github.com/example/catalog', plugins_count: null },
    { html_url: 'https://github.com/example/another', plugins_count: null },
  ])
  expect(db.prepare('SELECT query_id FROM discovery_candidates WHERE repository_id = 1 ORDER BY query_id').all()).toEqual([
    { query_id: 'metadata_marketplace' },
    { query_id: 'topic_claude_plugin' },
  ])
  expect(checkpoint(db)).toMatchObject({
    status: 'complete',
    pages_fetched: 2,
    total_count: 101,
    candidate_count: 2,
    incomplete_results: 0,
  })
})

it('advances historical created work even when rolling pushed partitions saturate the request budget', async () => {
  const db = database()
  const calls: string[] = []
  const result = await discoverRepositories(
    db,
    reader(async (query) => {
      calls.push(query)
      return query.includes(' pushed:')
        ? page(
            Array.from({ length: 100 }, () => item('rolling')),
            1000,
          )
        : page()
    }),
    'run',
    undefined,
    () => at,
  )

  expect(result.pagesFetched).toBe(20)
  expect(calls.some((query) => query.includes(' created:'))).toBe(true)
  expect(calls.filter((query) => query.includes(' pushed:'))).toHaveLength(15)
})

it('returns unused historical request reserve to rolling work', async () => {
  const db = database()
  const now = '2008-06-01T12:00:00Z'
  for (const query of repositorySearchQueries.slice(1)) {
    const partition = ensureRepositorySearchPartition(db, query.queryId, {
      field: 'created',
      start: '2008-01-01',
      end: '2008-12-31',
    })
    Object.assign(partition, { status: 'complete', last_completed_at: now })
    saveRepositorySearchPartition(db, partition)
  }
  const calls: string[] = []
  await discoverRepositories(
    db,
    reader(async (query) => {
      calls.push(query)
      return query.includes(' pushed:')
        ? page(
            Array.from({ length: 100 }, () => item('rolling')),
            1000,
          )
        : page()
    }),
    'run',
    undefined,
    () => now,
  )

  expect(calls).toHaveLength(20)
  expect(calls.filter((query) => query.includes(' created:'))).toHaveLength(1)
  expect(calls.filter((query) => query.includes(' pushed:'))).toHaveLength(19)
})

it('caps invocations at 20 requests and resumes an interrupted partition from page 1 idempotently', async () => {
  const db = database()
  const interruptedQuery = 'topic:claude-code-plugin is:public pushed:2026-10-01..2026-10-30'
  let calls = 0
  let firstScan = true
  await discoverRepositories(
    db,
    reader(async (query, number) => {
      calls++
      if (query === interruptedQuery && firstScan)
        return page(
          Array.from({ length: 100 }, () => item('catalog')),
          250,
          true,
        )
      if (query === interruptedQuery)
        return page(
          Array.from({ length: number === 3 ? 50 : 100 }, () => item('catalog')),
          250,
        )
      return page()
    }),
    'run',
    undefined,
    () => at,
  )
  firstScan = false
  expect(calls).toBe(20)
  expect(checkpoint(db, 'topic_claude_code_plugin')).toMatchObject({ status: 'incomplete', pages_fetched: 1, last_completed_at: null })

  const interruptedCalls: Array<[string, number]> = []
  await discoverRepositories(
    db,
    reader(async (query, number) => {
      interruptedCalls.push([query, number])
      if (query === interruptedQuery)
        return page(
          Array.from({ length: number === 3 ? 50 : 100 }, () => item('catalog')),
          250,
        )
      return page()
    }),
    'run',
    undefined,
    () => '2026-10-30T13:00:00Z',
  )
  expect(interruptedCalls.length).toBeLessThanOrEqual(20)
  expect(interruptedCalls.filter(([query]) => query === interruptedQuery)).toEqual([
    [interruptedQuery, 1],
    [interruptedQuery, 2],
    [interruptedQuery, 3],
  ])
  expect(checkpoint(db, 'topic_claude_code_plugin')).toMatchObject({ status: 'complete', pages_fetched: 3, candidate_count: 1 })
  expect(db.prepare('SELECT COUNT(*) AS count FROM repositories').get()).toEqual({ count: 1 })
})

it('resumes an unfinished rolling leaf at its persisted page and discovers a page-two candidate', async () => {
  const db = database()
  const query = repositorySearchQueries[0]
  const oldWindow = { field: 'pushed' as const, start: '2026-08-13', end: '2026-08-13' }
  const oldPartition = ensureRepositorySearchPartition(db, query.queryId, oldWindow)
  Object.assign(oldPartition, {
    status: 'incomplete',
    last_attempt_at: '2026-10-29T12:00:00Z',
    total_count: 250,
    pages_fetched: 1,
    next_page: 2,
  })
  saveRepositorySearchPartition(db, oldPartition)

  const oldQuery = `${query.queryText} pushed:2026-08-13..2026-08-13`
  const calls: Array<[string, number]> = []
  await discoverRepositories(
    db,
    reader(async (queryText, pageNumber) => {
      calls.push([queryText, pageNumber])
      if (queryText === oldQuery && pageNumber === 2)
        return page([item('page-two-target'), ...Array.from({ length: 99 }, (_, index) => item(`page-two-${index}`))], 250)
      if (queryText === oldQuery && pageNumber === 3)
        return page(
          Array.from({ length: 50 }, (_, index) => item(`page-three-${index}`)),
          250,
        )
      return page()
    }),
    'run',
    undefined,
    () => at,
  )

  expect(calls.filter(([queryText]) => queryText === oldQuery)).toEqual([
    [oldQuery, 2],
    [oldQuery, 3],
  ])
  expect(checkpoint(db, query.queryId, oldPartition.partition_key)).toMatchObject({
    status: 'complete',
    next_page: 4,
    pages_fetched: 2,
  })
  expect(db.prepare("SELECT html_url FROM repositories WHERE description = 'page-two-target'").get()).toEqual({
    html_url: 'https://github.com/example/page-two-target',
  })
})

it('resumes from the next page after a temporary page request failure', async () => {
  const db = database()
  const query = repositorySearchQueries[repositorySearchQueries.length - 1]
  const window = rollingPushedWindow(at)
  const queryText = `${query.queryText} pushed:${window.start}..${window.end}`
  const targetPartition = ensureRepositorySearchPartition(db, query.queryId, window)
  Object.assign(targetPartition, {
    status: 'incomplete',
    last_attempt_at: '2026-10-29T12:00:00Z',
    total_count: 250,
    pages_fetched: 1,
    next_page: 2,
  })
  saveRepositorySearchPartition(db, targetPartition)
  const callsByRun: Array<Array<[string, number]>> = []

  for (let attempt = 0; attempt < 2; attempt++) {
    const calls: Array<[string, number]> = []
    await discoverRepositories(
      db,
      reader(async (queryToRun, pageNumber) => {
        calls.push([queryToRun, pageNumber])
        if (queryToRun !== queryText) return page()
        if (attempt === 0 && pageNumber === 3) throw new GitHubTemporaryError('unavailable', 503, 0)
        const items = Array.from({ length: 100 }, (_, index) => item(`page-${pageNumber}-${index}`))
        if (pageNumber === 2) items[0] = item('found-after-resume')
        if (pageNumber === 3) return page(items.slice(0, 50), 250)
        return page(items, 250)
      }),
      'run',
      undefined,
      () => at,
    )
    callsByRun.push(calls.filter(([queryToRun]) => queryToRun === queryText))
  }

  expect(callsByRun).toEqual([
    [
      [queryText, 2],
      [queryText, 3],
    ],
    [[queryText, 3]],
  ])
  expect(checkpoint(db, query.queryId)).toMatchObject({ status: 'complete', next_page: 4 })
  expect(db.prepare("SELECT html_url FROM repositories WHERE description = 'found-after-resume'").get()).toEqual({
    html_url: 'https://github.com/example/found-after-resume',
  })
})

it('resumes the least recently attempted old rolling leaf before an older date leaf', async () => {
  const db = database()
  const query = repositorySearchQueries[0]
  const moreRecentlyAttempted = ensureRepositorySearchPartition(db, query.queryId, {
    field: 'pushed',
    start: '2026-10-02',
    end: '2026-10-03',
  })
  Object.assign(moreRecentlyAttempted, { status: 'incomplete', last_attempt_at: '2026-10-29T12:00:00Z' })
  saveRepositorySearchPartition(db, moreRecentlyAttempted)
  const lessRecentlyAttempted = ensureRepositorySearchPartition(db, query.queryId, {
    field: 'pushed',
    start: '2026-10-04',
    end: '2026-10-05',
  })
  Object.assign(lessRecentlyAttempted, { status: 'incomplete', last_attempt_at: '2026-10-28T12:00:00Z' })
  saveRepositorySearchPartition(db, lessRecentlyAttempted)

  const firstOldQuery = `${query.queryText} pushed:2026-10-02..2026-10-03`
  const secondOldQuery = `${query.queryText} pushed:2026-10-04..2026-10-05`
  const oldCalls: string[] = []
  await discoverRepositories(
    db,
    reader(async (queryText) => {
      if (queryText === firstOldQuery || queryText === secondOldQuery) oldCalls.push(queryText)
      return page()
    }),
    'run',
    undefined,
    () => at,
  )

  expect(oldCalls).toEqual([secondOldQuery, firstOldQuery])
})

it('resumes the least recently attempted historical leaf first', async () => {
  const db = database()
  for (const window of historicalWindows(at))
    for (const query of repositorySearchQueries) {
      const partition = ensureRepositorySearchPartition(db, query.queryId, window)
      Object.assign(partition, { status: 'complete', last_completed_at: at })
      saveRepositorySearchPartition(db, partition)
    }

  const query = repositorySearchQueries[0]
  const moreRecentlyAttempted = ensureRepositorySearchPartition(db, query.queryId, {
    field: 'created',
    start: '2008-01-01',
    end: '2008-12-31',
  })
  Object.assign(moreRecentlyAttempted, { status: 'incomplete', last_attempt_at: '2026-10-29T12:00:00Z', last_completed_at: null })
  saveRepositorySearchPartition(db, moreRecentlyAttempted)
  const lessRecentlyAttempted = ensureRepositorySearchPartition(db, query.queryId, {
    field: 'created',
    start: '2009-01-01',
    end: '2009-12-31',
  })
  Object.assign(lessRecentlyAttempted, { status: 'incomplete', last_attempt_at: '2026-10-28T12:00:00Z', last_completed_at: null })
  saveRepositorySearchPartition(db, lessRecentlyAttempted)

  const calls: string[] = []
  await discoverRepositories(
    db,
    reader(async (queryText) => {
      if (queryText.includes(' created:')) calls.push(queryText)
      return page()
    }),
    'run',
    undefined,
    () => at,
  )

  expect(calls.slice(0, 2)).toEqual([
    `${query.queryText} created:2009-01-01..2009-12-31`,
    `${query.queryText} created:2008-01-01..2008-12-31`,
  ])
})

it('splits 1,000-result windows at inclusive date midpoints and persists only complete leaves as covered', async () => {
  const db = database()
  const calls: Array<[string, number]> = []
  await discoverRepositories(
    db,
    reader(async (query, number) => {
      calls.push([query, number])
      if (query === firstPushed) return page([item('parent')], 1000)
      if (query === `${firstQuery.queryText} pushed:2026-10-01..2026-10-15`) return page([item('left')])
      if (query === `${firstQuery.queryText} pushed:2026-10-16..2026-10-30`) return page([item('right')])
      return page()
    }),
    'run',
    undefined,
    () => at,
  )
  expect(calls.slice(0, repositorySearchQueries.length).map(([query]) => query)).toEqual(
    repositorySearchQueries.map(({ queryText }) => `${queryText} pushed:2026-10-01..2026-10-30`),
  )
  expect(calls.slice(repositorySearchQueries.length, repositorySearchQueries.length + 2)).toEqual([
    [`${firstQuery.queryText} pushed:2026-10-16..2026-10-30`, 1],
    [`${firstQuery.queryText} pushed:2026-10-01..2026-10-15`, 1],
  ])
  expect(calls.findIndex(([query]) => query === firstCreated)).toBe(repositorySearchQueries.length + 2)
  expect(checkpoint(db)).toMatchObject({ status: 'split', saturated: 1, pages_fetched: 1, last_completed_at: null })
  expect(checkpoint(db, firstQuery.queryId, 'pushed:2026-10-01..2026-10-15')).toMatchObject({ status: 'complete' })
  expect(checkpoint(db, firstQuery.queryId, 'pushed:2026-10-16..2026-10-30')).toMatchObject({ status: 'complete' })
  expect(db.prepare('SELECT html_url FROM repositories ORDER BY html_url').all()).toEqual([
    { html_url: 'https://github.com/example/left' },
    { html_url: 'https://github.com/example/parent' },
    { html_url: 'https://github.com/example/right' },
  ])
})

it('reserves rolling and historical request budgets while checking newest split windows first', async () => {
  const db = database()
  const calls: string[] = []
  await discoverRepositories(
    db,
    reader(async (query) => {
      calls.push(query)
      if (query.endsWith('pushed:2026-10-01..2026-10-30')) return page([], 1000)
      return page()
    }),
    'run',
    undefined,
    () => at,
  )

  const queryIds = calls.map((query) => repositorySearchQueries.find((catalog) => query.startsWith(catalog.queryText))?.queryId)
  expect(queryIds.slice(0, repositorySearchQueries.length)).toEqual(repositorySearchQueries.map(({ queryId }) => queryId))
  expect(queryIds.slice(repositorySearchQueries.length, 15)).toEqual(repositorySearchQueries.slice(0, 7).map(({ queryId }) => queryId))
  expect(calls.slice(repositorySearchQueries.length, 15).every((query) => query.endsWith('pushed:2026-10-16..2026-10-30'))).toBe(true)
  expect(calls.slice(15).every((query) => query.includes(' created:'))).toBe(true)
})

it('does not cache incomplete responses and restarts them at page 1', async () => {
  const db = database()
  await discoverRepositories(
    db,
    reader(async (query) => (query === firstPushed ? page([item('catalog')], 1, true) : page())),
    'run',
    undefined,
    () => at,
  )
  expect(checkpoint(db)).toMatchObject({ status: 'incomplete', incomplete_results: 1, last_completed_at: null })
  const calls: Array<[string, number]> = []
  await discoverRepositories(
    db,
    reader(async (query, number) => {
      calls.push([query, number])
      return page()
    }),
    'run',
    undefined,
    () => at,
  )
  expect(calls).toContainEqual([firstPushed, 1])
  expect(checkpoint(db)).toMatchObject({ status: 'complete', incomplete_results: 0 })
})

it.each([
  [
    'a changed result count',
    () =>
      page(
        Array.from({ length: 100 }, (_, index) => item(`changed-${index}`)),
        251,
      ),
  ],
  [
    'a short page before the reported end',
    () =>
      page(
        Array.from({ length: 50 }, (_, index) => item(`short-${index}`)),
        250,
      ),
  ],
])('resets page progress after %s', async (_reason, inconsistentPage) => {
  const db = database()
  const query = repositorySearchQueries[0]
  const window = rollingPushedWindow(at)
  const partition = ensureRepositorySearchPartition(db, query.queryId, window)
  Object.assign(partition, {
    status: 'incomplete',
    last_attempt_at: '2026-10-29T12:00:00Z',
    total_count: 250,
    pages_fetched: 1,
    next_page: 2,
  })
  saveRepositorySearchPartition(db, partition)

  const queryText = `${query.queryText} pushed:${window.start}..${window.end}`
  const attemptedPages: number[] = []
  await discoverRepositories(
    db,
    reader(async (queryToRun, pageNumber) => {
      if (queryToRun === queryText) attemptedPages.push(pageNumber)
      return queryToRun === queryText && pageNumber === 2 ? inconsistentPage() : page()
    }),
    'run',
    undefined,
    () => at,
  )
  expect(attemptedPages).toEqual([2])
  expect(checkpoint(db, query.queryId, partition.partition_key)).toMatchObject({ status: 'incomplete', next_page: 1 })

  attemptedPages.length = 0
  await discoverRepositories(
    db,
    reader(async (queryToRun, pageNumber) => {
      if (queryToRun === queryText) attemptedPages.push(pageNumber)
      return page()
    }),
    'run',
    undefined,
    () => at,
  )
  expect(attemptedPages[0]).toBe(1)
})

it('leaves interrupted work incomplete before propagating an unexpected reader failure', async () => {
  const db = database()
  const failure = new Error('connection interrupted')
  await expect(
    discoverRepositories(
      db,
      reader(async (_query, number) => {
        if (number === 1)
          return page(
            Array.from({ length: 100 }, () => item('catalog')),
            101,
          )
        throw failure
      }),
      'run',
      undefined,
      () => at,
    ),
  ).rejects.toBe(failure)
  expect(checkpoint(db)).toMatchObject({ status: 'incomplete', last_completed_at: null })
  const calls: Array<[string, number]> = []
  await discoverRepositories(
    db,
    reader(async (query, number) => {
      calls.push([query, number])
      return page()
    }),
    'run',
    undefined,
    () => at,
  )
  expect(calls.filter(([query]) => query === firstPushed)[0]).toEqual([firstPushed, 2])
  expect(db.prepare('SELECT COUNT(*) AS count FROM repositories').get()).toEqual({ count: 1 })
})

it('continues after temporary failures while retaining the failed partition for retry', async () => {
  const db = database()
  const result = await discoverRepositories(
    db,
    reader(async (query) => {
      if (query === firstPushed) throw new GitHubTemporaryError('unavailable', 503, 2)
      return page()
    }),
    'run',
    undefined,
    () => at,
  )
  expect(result).toMatchObject({ state: 'incomplete', pagesFetched: 20 })
  expect(checkpoint(db)).toMatchObject({ status: 'incomplete', pages_fetched: 1, last_completed_at: null })
  expect(checkpoint(db, 'metadata_marketplace')).toMatchObject({ status: 'complete' })
})

it('requests a single transport attempt for every page and defers transient partitions to a later crawl', async () => {
  const db = database()
  let calls = 0
  const result = await discoverRepositories(
    db,
    reader(async (query, number, options) => {
      expect(number).toBe(1)
      expect(options).toEqual(query.includes(' pushed:') ? { maxAttempts: 1, sort: 'updated' } : { maxAttempts: 1 })
      calls++
      throw new GitHubTemporaryError('unavailable', 503, 0)
    }),
    'run',
    undefined,
    () => at,
  )
  expect(calls).toBe(20)
  expect(result).toMatchObject({ pagesFetched: 20, state: 'incomplete' })
  expect(checkpoint(db)).toMatchObject({ status: 'incomplete', pages_fetched: 1, last_completed_at: null })
})

it('enforces the 20-request cap on actual HTTP attempts when the GitHub transport fails', async () => {
  const db = database()
  let attempts = 0
  let time = 0
  const client = new GitHubClient({
    token: 'offline-test',
    clock: {
      now: () => time,
      sleep: async (ms) => {
        time += ms
      },
    },
    fetch: async () => {
      attempts++
      return new Response('', { status: 503 })
    },
  })
  const result = await discoverRepositories(db, client, 'run', undefined, () => at)
  expect(attempts).toBe(20)
  expect(result).toMatchObject({ pagesFetched: 20, state: 'incomplete' })
  expect(checkpoint(db)).toMatchObject({ status: 'incomplete', last_completed_at: null })
})

it('drains the historical sweep across runs, keeps pushed scans recurring, then refreshes oldest historical leaves after 90 days', async () => {
  const db = database()
  let summary: Awaited<ReturnType<typeof discoverRepositories>> | undefined
  for (let run = 0; run < 13; run++) {
    summary = await discoverRepositories(
      db,
      reader(async () => page()),
      'run',
      undefined,
      () => at,
    )
    expect(summary.pagesFetched).toBeLessThanOrEqual(20)
  }
  expect(summary).toMatchObject({ state: 'complete' })
  const calls: string[] = []
  await discoverRepositories(
    db,
    reader(async (query) => {
      calls.push(query)
      return page()
    }),
    'run',
    undefined,
    () => at,
  )
  expect(calls).toHaveLength(repositorySearchQueries.length)
  expect(calls.every((query) => query.includes(' pushed:'))).toBe(true)

  db.prepare("UPDATE repository_search_partitions SET last_completed_at = '2026-08-02T12:00:00Z' WHERE date_field = 'created'").run()
  db.prepare(`UPDATE repository_search_partitions SET last_completed_at = ?
    WHERE date_field = 'created' AND query_id = ? AND date_start = ?`).run('2026-08-01T12:00:00Z', 'metadata_plugin', '2008-01-01')
  db.prepare(`UPDATE repository_search_partitions SET last_completed_at = ?
    WHERE date_field = 'created' AND query_id = ? AND date_start = ?`).run('2026-07-31T12:00:00Z', 'readme_plugin', '2010-01-01')
  const refreshCalls: string[] = []
  const refreshed = await discoverRepositories(
    db,
    reader(async (query) => {
      refreshCalls.push(query)
      return page()
    }),
    'run',
    undefined,
    () => at,
  )
  expect(refreshCalls.slice(repositorySearchQueries.length)).toEqual([
    'claude plugin in:readme is:public created:2010-01-01..2010-12-31',
    'claude plugin in:name,description,topics is:public created:2008-01-01..2008-12-31',
  ])
  expect(refreshed.state).toBe('complete')
})

it('advances unswept historical work before overdue historical refreshes', async () => {
  const db = database()
  await discoverRepositories(
    db,
    reader(async () => page()),
    'run',
    undefined,
    () => at,
  )
  db.exec(
    "UPDATE repository_search_partitions SET last_completed_at = '2026-01-01T00:00:00Z' WHERE date_field = 'created' AND status = 'complete'",
  )
  const calls: string[] = []
  await discoverRepositories(
    db,
    reader(async (query) => {
      calls.push(query)
      return page()
    }),
    'run',
    undefined,
    () => at,
  )
  expect(calls[repositorySearchQueries.length]).toBe('claude plugin in:name,description,topics is:public created:2009-01-01..2009-12-31')
  expect(calls).not.toContain(firstCreated)
})

it('keeps one-day saturated windows and unexpected short pages incomplete', async () => {
  const db = database()
  const fresh = '2026-10-30T11:00:00Z'
  for (const query of repositorySearchQueries) {
    const pushed = ensureRepositorySearchPartition(db, query.queryId, rollingPushedWindow(at))
    Object.assign(pushed, { status: 'complete', last_attempt_at: fresh, last_completed_at: fresh })
    saveRepositorySearchPartition(db, pushed)
    for (const window of historicalWindows(at)) {
      const historical = ensureRepositorySearchPartition(db, query.queryId, window)
      Object.assign(historical, { status: 'complete', last_attempt_at: fresh, last_completed_at: fresh })
      saveRepositorySearchPartition(db, historical)
    }
  }

  let window = historicalWindows(at)[0]
  while (window.start !== window.end) {
    const parent = ensureRepositorySearchPartition(db, 'metadata_plugin', window)
    parent.status = 'split'
    saveRepositorySearchPartition(db, parent)
    const children = splitDateWindow(window)
    if (!children) throw new Error('Expected a date split')
    const [, right] = children
    const completed = ensureRepositorySearchPartition(db, 'metadata_plugin', right)
    Object.assign(completed, { status: 'complete', last_attempt_at: fresh, last_completed_at: fresh })
    saveRepositorySearchPartition(db, completed)
    window = children[0]
  }

  const oneDay = ensureRepositorySearchPartition(db, 'metadata_plugin', window)
  oneDay.status = 'pending'
  saveRepositorySearchPartition(db, oneDay)
  const result = await discoverRepositories(
    db,
    reader(async (query) => {
      if (query.startsWith('claude plugin in:name') && query.endsWith(`created:${window.start}..${window.end}`))
        return page([item('catalog')], 1000)
      return page()
    }),
    'run',
    undefined,
    () => at,
  )
  expect(result.pagesFetched).toBeLessThanOrEqual(20)
  expect(checkpoint(db, 'metadata_plugin', `created:${window.start}..${window.end}`)).toMatchObject({
    status: 'incomplete',
    saturated: 1,
    last_completed_at: null,
    pages_fetched: 1,
  })
})

it('reports due rolling partitions as incomplete when the budget expires before revisiting their previous completions', async () => {
  const db = database()
  for (let run = 0; run < 13; run++)
    await discoverRepositories(
      db,
      reader(async () => page()),
      'run',
      undefined,
      () => at,
    )
  const result = await discoverRepositories(
    db,
    reader(async (query, number) => {
      expect(query.includes(' pushed:')).toBe(true)
      return page(
        Array.from({ length: number === 10 ? 99 : 100 }, () => item('catalog')),
        999,
      )
    }),
    'run',
    undefined,
    () => at,
  )
  expect(result).toMatchObject({ state: 'incomplete', pagesFetched: 20, completedPartitions: 2, incompletePartitions: 6 })
})

it('resumes a split historical tree without repeating its parent or its completed child', async () => {
  const db = database()
  const left = `${firstQuery.queryText} created:2008-01-01..2008-07-01`
  const right = `${firstQuery.queryText} created:2008-07-02..2008-12-31`
  await discoverRepositories(
    db,
    reader(async (query) => {
      if (query === firstCreated) return page([item('catalog')], 1000)
      if (query === right) return page([item('catalog')], 1, true)
      return page()
    }),
    'run',
    undefined,
    () => at,
  )
  const calls: Array<[string, number]> = []
  await discoverRepositories(
    db,
    reader(async (query, number) => {
      calls.push([query, number])
      return page()
    }),
    'run',
    undefined,
    () => at,
  )
  expect(calls).toContainEqual([right, 1])
  expect(calls.map(([query]) => query)).not.toContain(firstCreated)
  expect(calls.map(([query]) => query)).not.toContain(left)
})

it('prioritizes rolling queries that earlier budgets never reached before revisiting already attempted rolling queries', async () => {
  const db = database()
  await discoverRepositories(
    db,
    reader(async (_query, number) =>
      page(
        Array.from({ length: number === 10 ? 99 : 100 }, () => item('catalog')),
        999,
      ),
    ),
    'run',
    undefined,
    () => at,
  )
  const calls: string[] = []
  await discoverRepositories(
    db,
    reader(async (query) => {
      calls.push(query)
      return page()
    }),
    'run',
    undefined,
    () => '2026-10-30T13:00:00Z',
  )
  expect(calls.slice(0, 4)).toEqual([
    'topic:claude-code-marketplace is:public pushed:2026-10-01..2026-10-30',
    'topic:claude-code-plugins is:public pushed:2026-10-01..2026-10-30',
    'topic:claude-code-plugin is:public pushed:2026-10-01..2026-10-30',
    'claude plugin in:name,description,topics is:public pushed:2026-10-01..2026-10-30',
  ])
})

it('resumes incomplete pushed partitions from a prior daily rolling window', async () => {
  const db = database()
  const query = repositorySearchQueries[0]
  const oldWindow = { field: 'pushed' as const, start: '2026-10-16', end: '2026-10-30' }
  const oldPartition = ensureRepositorySearchPartition(db, query.queryId, oldWindow)
  Object.assign(oldPartition, {
    status: 'incomplete',
    last_attempt_at: at,
    pages_fetched: 1,
    total_count: 1177,
    saturated: 1,
  })
  saveRepositorySearchPartition(db, oldPartition)
  completeRun(db, 'run', '2026-10-30T12:30:00Z', 0)
  beginRun(db, 'next-day', '2026-10-31T12:00:00Z')

  const queries: string[] = []
  await discoverRepositories(
    db,
    reader(async (queryText) => {
      queries.push(queryText)
      return page()
    }),
    'next-day',
    undefined,
    () => '2026-10-31T12:00:00Z',
  )

  expect(queries).toContain(`${query.queryText} pushed:2026-10-16..2026-10-30`)
  expect(checkpoint(db, query.queryId, 'pushed:2026-10-16..2026-10-30')).toMatchObject({
    status: 'complete',
    pages_fetched: 1,
  })
})

it('resumes old rolling leaves even when newly split query families consume the request budget', async () => {
  const db = database()
  const query = repositorySearchQueries[0]
  const oldWindow = { field: 'pushed' as const, start: '2026-10-16', end: '2026-10-30' }
  const oldPartition = ensureRepositorySearchPartition(db, query.queryId, oldWindow)
  Object.assign(oldPartition, { status: 'incomplete', last_attempt_at: at, total_count: 1177, saturated: 1 })
  saveRepositorySearchPartition(db, oldPartition)
  completeRun(db, 'run', '2026-10-30T12:30:00Z', 0)
  beginRun(db, 'next-day', '2026-10-31T12:00:00Z')

  const oldQuery = `${query.queryText} pushed:2026-10-16..2026-10-30`
  const calls: string[] = []
  await discoverRepositories(
    db,
    reader(async (queryText) => {
      calls.push(queryText)
      return queryText === oldQuery ? page() : page([], 1000)
    }),
    'next-day',
    undefined,
    () => '2026-10-31T12:00:00Z',
  )

  expect(calls).toHaveLength(20)
  expect(calls).toContain(oldQuery)
  expect(checkpoint(db, query.queryId, oldPartition.partition_key)).toMatchObject({ status: 'complete', pages_fetched: 1 })
})

it('keeps the completed current-year sweep cached when the UTC day changes', async () => {
  const db = database()
  for (let run = 0; run < 13; run++)
    await discoverRepositories(
      db,
      reader(async () => page()),
      'run',
      undefined,
      () => at,
    )
  const calls: string[] = []
  await discoverRepositories(
    db,
    reader(async (query) => {
      calls.push(query)
      return page()
    }),
    'run',
    undefined,
    () => '2026-10-31T12:00:00Z',
  )
  expect(calls).toHaveLength(repositorySearchQueries.length)
  expect(calls.every((query) => query.includes(' pushed:2026-10-02..2026-10-31'))).toBe(true)
  expect(checkpoint(db, 'metadata_plugin', 'created:2026-01-01..2026-12-31')).toMatchObject({ status: 'complete' })
})

it('isolates checkpoint versions so a different catalog cannot suppress the current sweep', async () => {
  const db = database()
  await discoverRepositories(
    db,
    reader(async () => page()),
    'run',
    undefined,
    () => at,
  )
  db.prepare('UPDATE repository_search_partitions SET query_version = 3').run()
  const calls: string[] = []
  await discoverRepositories(
    db,
    reader(async (query) => {
      calls.push(query)
      return page()
    }),
    'run',
    undefined,
    () => at,
  )
  expect(calls).toContain(firstCreated)
  expect(db.prepare('SELECT DISTINCT query_version FROM repository_search_partitions ORDER BY query_version').all()).toEqual([
    { query_version: 2 },
    { query_version: 3 },
  ])
})

it('logs a budget-skipped due partition as incomplete rather than reusing its previous complete state', async () => {
  const db = database()
  const events: Array<Record<string, unknown>> = []
  // The rolling lane consumes the request budget before a due historical refresh.
  db.prepare(
    "INSERT INTO repository_search_partitions (query_version, query_id, partition_key, date_field, date_start, date_end, status, last_attempt_at, last_completed_at) VALUES (2, 'metadata_plugin', 'created:2008-01-01..2008-12-31', 'created', '2008-01-01', '2008-12-31', 'complete', ?, ?)",
  ).run('2026-07-31T00:00:00Z', '2026-07-31T00:00:00Z')
  await discoverRepositories(
    db,
    reader(async () => page([], 1000)),
    'run',
    undefined,
    () => at,
    (event) => events.push(event),
  )
  expect(events).toContainEqual(
    expect.objectContaining({
      event: 'crawl.repository_search.partition',
      queryId: 'metadata_plugin',
      partitionKey: 'created:2008-01-01..2008-12-31',
      state: 'incomplete',
      reason: 'request-budget',
      pagesFetched: 0,
    }),
  )
})

it('logs the partition outcome before propagating fatal Repository Search errors', async () => {
  const db = database()
  const events: Array<Record<string, unknown>> = []
  await expect(
    discoverRepositories(
      db,
      reader(async () => {
        throw new GitHubFatalError('invalid query', 422)
      }),
      'run',
      undefined,
      () => at,
      (event) => events.push(event),
    ),
  ).rejects.toBeInstanceOf(GitHubFatalError)
  expect(events).toContainEqual(
    expect.objectContaining({
      event: 'crawl.repository_search.partition',
      queryId: 'topic_claude_plugin',
      queryVersion: repositorySearchQueryVersion,
      partitionKey: 'pushed:2026-10-01..2026-10-30',
      state: 'incomplete',
      reason: 'fatal-error',
    }),
  )
})

it('does not rediscover unchanged marketplace 404 rejections but retries after a new push', async () => {
  const db = database()
  recordRejectedCandidate(db, 'https://github.com/example/rejected', 'node-rejected', at)
  const oldPush = '2026-10-29T11:00:00Z'
  const newPush = '2026-10-31T11:00:00Z'
  const current = () => '2026-10-30T12:30:00Z'
  const first = await discoverRepositories(
    db,
    reader(async (query) => query === firstPushed ? page([item('rejected', { pushed_at: oldPush })]) : page()),
    'run', undefined, current,
  )
  expect(first.uniqueCandidates).toBe(0)
  expect(db.prepare('SELECT COUNT(*) AS n FROM repositories').get()).toEqual({ n: 0 })
  const second = await discoverRepositories(
    db,
    reader(async (query) => query === firstPushed ? page([item('rejected', { pushed_at: newPush })]) : page()),
    'run', undefined, current,
  )
  expect(second.uniqueCandidates).toBe(1)
  expect(db.prepare('SELECT COUNT(*) AS n FROM repositories').get()).toEqual({ n: 1 })
  expect(db.prepare('SELECT COUNT(*) AS n FROM rejected_repository_candidates').get()).toEqual({ n: 0 })
})

it('bounds the pushed backlog over consecutive saturated days', async () => {
  const db = database()
  const origin = Date.parse(at)
  for (let day = 0; day < 65; day++) {
    const now = new Date(origin + day * 86_400_000).toISOString()
    await discoverRepositories(
      db,
      reader(async (query) => query.includes(' pushed:') ? page([], 1000) : page()),
      'run', undefined, () => now,
    )
    const activeStart = rollingPushedWindow(now).start
    const expired = db.prepare(`
      SELECT COUNT(*) AS n FROM repository_search_partitions
      WHERE date_field = 'pushed' AND date_end < ?
    `).get(activeStart) as { n: number }
    expect(expired.n).toBe(0)
    const pending = db.prepare(`
      SELECT COUNT(*) AS n FROM repository_search_partitions
      WHERE date_field = 'pushed' AND status IN ('pending', 'incomplete')
    `).get() as { n: number }
    expect(pending.n).toBeLessThan(2000)
  }
})
