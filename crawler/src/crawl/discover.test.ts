import Database from 'better-sqlite3'
import { afterEach, expect, it } from 'vitest'
import { GitHubFatalError, type GitHubReader, GitHubTemporaryError, type SearchPage } from '../github/client.js'
import type { SizeRange } from '../github/sizeRanges.js'
import { updateEnriched, upsertDiscovery } from '../storage/repositories.js'
import { beginRun, listRunErrors } from '../storage/runs.js'
import { initializeSchema } from '../storage/schema.js'
import { discover } from './discover.js'

const databases: Database.Database[] = []
const firstRange: SizeRange = [0, 150]
const secondRange: SizeRange = [150, 200]

function database(): Database.Database {
  const db = new Database(':memory:')
  initializeSchema(db)
  beginRun(db, 'run-1', '2026-09-23T00:00:00Z')
  databases.push(db)
  return db
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})

function item(url: string, description: string | null = null): SearchPage['items'][number] {
  return { repository: { html_url: url, description } }
}

function page(items: SearchPage['items'], total_count = items.length, incomplete_results = false): SearchPage {
  return { items, total_count, incomplete_results }
}

function reader(search: GitHubReader['searchCode']): GitHubReader {
  return {
    searchCode: search,
    getRepository: async () => {
      throw new Error('Discovery must not enrich repositories')
    },
    getMarketplace: async () => {
      throw new Error('Discovery must not fetch marketplaces')
    },
  }
}

function errors(db: Database.Database) {
  return listRunErrors(db, 'run-1').map(({ phase, range_start, range_end, error_type }) => ({
    phase,
    range_start,
    range_end,
    error_type,
  }))
}

it('counts an empty first page as a successful range without inserting rows or requesting page two', async () => {
  const db = database()
  const calls: Array<[string, number]> = []
  const result = await discover(
    db,
    reader(async (query, number) => {
      calls.push([query, number])
      return page([])
    }),
    'run-1',
    [firstRange],
  )

  expect(calls).toEqual([['filename:marketplace.json path:.claude-plugin size:0..150', 1]])
  expect(result).toEqual({ newUrls: 0, existingUrls: 0, successfulRanges: 1, warningCount: 0, warnings: [] })
  expect(db.prepare('SELECT COUNT(*) AS count FROM repositories').get()).toEqual({ count: 0 })
})

it('persists 100+1 results across two pages and stops on the short page', async () => {
  const db = database()
  const visited: number[] = []
  const result = await discover(
    db,
    reader(async (_query, number) => {
      visited.push(number)
      if (number === 1)
        return page(
          Array.from({ length: 100 }, (_, i) => item(`https://github.com/owner/repo-${i}`)),
          101,
        )
      if (number === 2) return page([item('https://github.com/owner/last')], 101)
      throw new Error('Unexpected extra page')
    }),
    'run-1',
    [firstRange],
  )

  expect(visited).toEqual([1, 2])
  expect(result).toMatchObject({ newUrls: 101, existingUrls: 0, successfulRanges: 1, warningCount: 0 })
  expect(db.prepare('SELECT COUNT(*) AS count FROM repositories').get()).toEqual({ count: 101 })
})

it('continues past a short page when total_count says more results remain', async () => {
  const db = database()
  const visited: number[] = []
  const result = await discover(
    db,
    reader(async (_query, number) => {
      visited.push(number)
      if (number === 1) return page(Array.from({ length: 40 }, (_, i) => item(`https://github.com/owner/first-${i}`)), 140)
      if (number === 2) return page(Array.from({ length: 100 }, (_, i) => item(`https://github.com/owner/second-${i}`)), 140)
      throw new Error('Unexpected extra page')
    }),
    'run-1',
    [firstRange],
  )

  expect(visited).toEqual([1, 2])
  expect(result).toMatchObject({ newUrls: 140, successfulRanges: 1, warningCount: 0 })
  expect(db.prepare('SELECT COUNT(*) AS count FROM repositories').get()).toEqual({ count: 140 })
})

it('stops at total_count even if the last page is full', async () => {
  const db = database()
  const visited: number[] = []
  const result = await discover(
    db,
    reader(async (_query, number) => {
      visited.push(number)
      return page(
        Array.from({ length: 100 }, (_, i) => item(`https://github.com/owner/repo-${i}`)),
        100,
      )
    }),
    'run-1',
    [firstRange],
  )

  expect(visited).toEqual([1])
  expect(result).toMatchObject({ newUrls: 100, warningCount: 0 })
})

it('splits a saturated size range until each child is below the search cap', async () => {
  const db = database()
  const queries: string[] = []
  const result = await discover(
    db,
    reader(async (query) => {
      queries.push(query)
      if (query.endsWith('0..3')) return page([], 1_000)
      if (query.endsWith('0..1')) return page([item('https://github.com/owner/small')])
      if (query.endsWith('2..3')) return page([item('https://github.com/owner/large')])
      throw new Error(`Unexpected range: ${query}`)
    }),
    'run-1',
    [[0, 3]],
  )

  expect(queries).toEqual([
    'filename:marketplace.json path:.claude-plugin size:0..3',
    'filename:marketplace.json path:.claude-plugin size:0..1',
    'filename:marketplace.json path:.claude-plugin size:2..3',
  ])
  expect(result).toMatchObject({ newUrls: 2, successfulRanges: 2, warningCount: 0 })
})

it.each([1000, 1001, 20_000])(
  'caps an unsplittable search claiming %i results at ten pages and records saturated coverage',
  async (total) => {
    const db = database()
    const visited: number[] = []
    const result = await discover(
      db,
      reader(async (_query, number) => {
        visited.push(number)
        return page(
          Array.from({ length: 100 }, (_, i) => item(`https://github.com/owner/repo-${(number - 1) * 100 + i}`)),
          total,
        )
      }),
      'run-1',
      [[0, 0]],
    )

    expect(visited).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(result).toMatchObject({ newUrls: 1000, existingUrls: 0, successfulRanges: 1, warningCount: 2 })
    expect(errors(db)).toEqual([
      { phase: 'search', range_start: 0, range_end: 0, error_type: 'saturated' },
      { phase: 'search', range_start: 0, range_end: 0, error_type: 'page-limit' },
    ])
  },
)

it('records incomplete_results with range bounds even when the first page is empty', async () => {
  const db = database()
  const result = await discover(
    db,
    reader(async () => page([], 0, true)),
    'run-1',
    [secondRange],
  )
  expect(result).toMatchObject({ successfulRanges: 1, newUrls: 0, warningCount: 1 })
  expect(errors(db)).toEqual([{ phase: 'search', range_start: 150, range_end: 200, error_type: 'incomplete-results' }])
})

it('counts overlapping URLs as existing and preserves enriched data while refreshing only unenriched descriptions', async () => {
  const db = database()
  const enrichedUrl = 'https://github.com/owner/enriched'
  const pendingUrl = 'https://github.com/owner/pending'
  const originalId = upsertDiscovery(db, enrichedUrl, 'search-original')
  updateEnriched(db, originalId, {
    stargazers_count: 10,
    forks_count: 2,
    subscribers_count: 3,
    description: 'authoritative REST description',
    owner: 'owner',
    owner_url: 'https://github.com/owner',
    repo_name: 'enriched',
    repo_updated: '2025-01-01T00:00:00Z',
    plugins_count: 0,
  })

  const result = await discover(
    db,
    reader(async (query) =>
      query.endsWith('0..150')
        ? page([item(enrichedUrl, 'stale description'), item(pendingUrl, 'first description')])
        : page([item(enrichedUrl, 'stale again'), item(pendingUrl, 'updated description')]),
    ),
    'run-1',
    [firstRange, secondRange],
  )

  expect(result).toMatchObject({ newUrls: 1, existingUrls: 3, successfulRanges: 2, warningCount: 0 })
  expect(db.prepare('SELECT id, description, stargazers_count FROM repositories WHERE html_url = ?').get(enrichedUrl)).toEqual({
    id: originalId,
    description: 'authoritative REST description',
    stargazers_count: 10,
  })
  expect(db.prepare('SELECT description FROM repositories WHERE html_url = ?').get(pendingUrl)).toEqual({
    description: 'updated description',
  })
  expect(db.prepare('SELECT COUNT(*) AS count FROM repositories').get()).toEqual({ count: 2 })
})

it('counts case-variant GitHub URLs as existing instead of new', async () => {
  const db = database()
  const id = upsertDiscovery(db, 'https://github.com/team/repo', 'old')

  const result = await discover(
    db,
    reader(async () => page([item('https://github.com/Team/Repo', 'rediscovered')])),
    'run-1',
    [firstRange],
  )

  expect(result).toMatchObject({ newUrls: 0, existingUrls: 1, successfulRanges: 1, warningCount: 0 })
  expect(db.prepare('SELECT id, html_url FROM repositories').all()).toEqual([{ id, html_url: 'https://github.com/team/repo' }])
})

it('persists the repository node ID returned by Code Search', async () => {
  const db = database()
  await discover(
    db,
    reader(async () =>
      page([{ repository: { html_url: 'https://github.com/team/repo', description: 'repo', node_id: 'MDEwOlJlcG9zaXRvcnkx' } }]),
    ),
    'run-1',
    [firstRange],
  )

  expect(db.prepare('SELECT github_node_id FROM repositories').get()).toEqual({ github_node_id: 'MDEwOlJlcG9zaXRvcnkx' })
})

it('ignores private repositories returned by authenticated code search', async () => {
  const db = database()
  const result = await discover(
    db,
    reader(async () =>
      page([
        { repository: { html_url: 'https://github.com/owner/private', description: 'secret', private: true } },
        item('https://github.com/owner/public', 'public'),
      ]),
    ),
    'run-1',
    [firstRange],
  )

  expect(result).toMatchObject({ newUrls: 1, existingUrls: 0, successfulRanges: 1, warningCount: 0 })
  expect(db.prepare('SELECT html_url FROM repositories').all()).toEqual([{ html_url: 'https://github.com/owner/public' }])
})

it('warns once per range for invalid repository URLs and never inserts them', async () => {
  const db = database()
  const badUrls = [
    'http://github.com/owner/repo',
    'https://evil.example/owner/repo',
    'https://github.com.evil.example/owner/repo',
    'https://user@github.com/owner/repo',
    'https://github.com:443/owner/repo',
    'https://github.com/owner/repo?foo=bar',
    'https://github.com/owner/repo#section',
    'https://github.com/owner/repo/more',
    'https://github.com/owner/repo/',
    'https://github.com/./repo',
    'https://github.com/owner/..',
    'https://github.com/owner/%2e%2e',
    'https://github.com//repo',
    'https://github.com/owner/',
    'https://github.com/owner/re%70o',
    'https://github.com/owner/repo\n',
    'https://github.com/owner/repo\r\n',
  ]
  const result = await discover(
    db,
    reader(async () => page([...badUrls.map((url) => item(url)), item('https://github.com/owner/valid', 'good')])),
    'run-1',
    [secondRange],
  )

  expect(result).toMatchObject({ newUrls: 1, existingUrls: 0, successfulRanges: 1, warningCount: 1 })
  expect(errors(db)).toEqual([{ phase: 'search', range_start: 150, range_end: 200, error_type: 'invalid-url' }])
  expect(db.prepare('SELECT html_url FROM repositories').all()).toEqual([{ html_url: 'https://github.com/owner/valid' }])
})

it('accepts legacy owner names with a leading or trailing hyphen for enrichment', async () => {
  const db = database()
  const urls = ['https://github.com/-legacy/repo', 'https://github.com/legacy-/repo']
  const result = await discover(
    db,
    reader(async () => page(urls.map((url) => item(url)))),
    'run-1',
    [firstRange],
  )

  expect(result).toMatchObject({ newUrls: 2, warningCount: 0 })
  expect(db.prepare('SELECT html_url FROM repositories ORDER BY id').all()).toEqual(urls.map((html_url) => ({ html_url })))
})

it('retains first-page rows and continues the next range when page two fails temporarily', async () => {
  const db = database()
  const visited: Array<[string, number]> = []
  const result = await discover(
    db,
    reader(async (query, number) => {
      visited.push([query.slice(-6), number])
      if (query.endsWith('0..150') && number === 1) {
        return page(
          Array.from({ length: 100 }, (_, i) => item(`https://github.com/owner/first-${i}`)),
          101,
        )
      }
      if (query.endsWith('0..150')) throw new GitHubTemporaryError('Retries exhausted', 503, 3)
      return page([item('https://github.com/owner/next')])
    }),
    'run-1',
    [firstRange, secondRange],
  )

  expect(visited.map(([, number]) => number)).toEqual([1, 2, 1])
  expect(result).toMatchObject({ newUrls: 101, successfulRanges: 2, warningCount: 1 })
  expect(errors(db)).toEqual([{ phase: 'search', range_start: 0, range_end: 150, error_type: 'temporary-error' }])
  expect(listRunErrors(db, 'run-1').map(({ retry_count }) => retry_count)).toEqual([3])
  expect(db.prepare('SELECT COUNT(*) AS count FROM repositories').get()).toEqual({ count: 101 })
})

it('makes a complete GitHub outage explicit so publication cannot mistake stale rows for a fresh crawl', async () => {
  const db = database()
  const knownId = upsertDiscovery(db, 'https://github.com/owner/known', 'old')
  const result = await discover(
    db,
    reader(async () => {
      throw new GitHubTemporaryError('Retries exhausted', null)
    }),
    'run-1',
    [firstRange, secondRange],
  )

  expect(result).toMatchObject({ newUrls: 0, existingUrls: 0, successfulRanges: 0, warningCount: 2 })
  expect(errors(db)).toEqual([
    { phase: 'search', range_start: 0, range_end: 150, error_type: 'temporary-error' },
    { phase: 'search', range_start: 150, range_end: 200, error_type: 'temporary-error' },
  ])
  expect(db.prepare('SELECT id, description FROM repositories').all()).toEqual([{ id: knownId, description: 'old' }])
})

it.each([401, 403, 422])('propagates a fatal %i without querying later ranges', async (status) => {
  const db = database()
  let attempts = 0
  await expect(
    discover(
      db,
      reader(async () => {
        attempts++
        throw new GitHubFatalError('Invalid GitHub configuration', status)
      }),
      'run-1',
      [firstRange, secondRange],
    ),
  ).rejects.toBeInstanceOf(GitHubFatalError)
  expect(attempts).toBe(1)
  expect(errors(db)).toEqual([])
})

it.each([401, 422])('never treats a %i response as a recoverable range failure', async (status) => {
  const db = database()
  let attempts = 0
  await expect(
    discover(
      db,
      reader(async () => {
        attempts++
        throw new GitHubTemporaryError('GitHub rejected search', status)
      }),
      'run-1',
      [firstRange, secondRange],
    ),
  ).rejects.toMatchObject({ status })
  expect(attempts).toBe(1)
  expect(errors(db)).toEqual([])
})
