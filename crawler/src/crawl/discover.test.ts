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

function item(url: string, description: string | null = null, path = '.claude-plugin/marketplace.json') {
  return { path, repository: { html_url: url, description } }
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
  return listRunErrors(db, 'run-1')
    .filter(({ query_family }) => query_family === 'marketplace_filename_path')
    .map(({ phase, range_start, range_end, error_type }) => ({ phase, range_start, range_end, error_type }))
}

function marketplaceQueries(queries: string[]): string[] {
  return queries.filter((query) => query.startsWith('filename:'))
}

function marketplaceCalls(calls: Array<[string, number]>): Array<[string, number]> {
  return calls.filter(([query]) => query.startsWith('filename:'))
}

it('runs both marketplace queries and counts an empty first page as successful coverage', async () => {
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

  expect(calls).toEqual([
    ['filename:marketplace.json path:.claude-plugin size:0..150', 1],
    ['.claude-plugin/marketplace.json in:path size:0..150', 1],
  ])
  expect(result).toEqual({
    newUrls: 0,
    existingUrls: 0,
    successfulRanges: 2,
    warningCount: 0,
    warnings: [],
    families: {
      marketplace_filename_path: { successfulRanges: 1, warningCount: 0 },
      marketplace_path_literal: { successfulRanges: 1, warningCount: 0 },
    },
  })
  expect(db.prepare('SELECT COUNT(*) AS count FROM repositories').get()).toEqual({ count: 0 })
})

it('runs both query families in order and caches successful empty coverage per family', async () => {
  const db = database()
  const calls: Array<[string, number]> = []
  const result = await discover(
    db,
    reader(async (query, number) => {
      calls.push([query, number])
      return page([])
    }),
    'run-1',
    [[0, 10]],
  )

  expect(calls).toEqual([
    ['filename:marketplace.json path:.claude-plugin size:0..10', 1],
    ['.claude-plugin/marketplace.json in:path size:0..10', 1],
  ])
  expect(result.families).toEqual({
    marketplace_filename_path: { successfulRanges: 1, warningCount: 0 },
    marketplace_path_literal: { successfulRanges: 1, warningCount: 0 },
  })
  expect(result.successfulRanges).toBe(2)
  expect(db.prepare('SELECT query_family, range_start, range_end FROM discovery_ranges ORDER BY query_family').all()).toEqual([
    { query_family: 'marketplace_filename_path', range_start: 0, range_end: 10 },
    { query_family: 'marketplace_path_literal', range_start: 0, range_end: 10 },
  ])
})

it('ignores a content match from CLAUDE.md in the literal manifest family', async () => {
  const db = database()
  const mentionedRepository = 'https://github.com/acme/mentioned-in-docs'
  const result = await discover(
    db,
    reader(async (query) =>
      query.startsWith('.claude-plugin/marketplace.json') ? page([item(mentionedRepository, null, 'CLAUDE.md')]) : page([]),
    ),
    'run-1',
    [firstRange],
  )

  expect(result.newUrls).toBe(0)
  expect(db.prepare('SELECT html_url FROM repositories').all()).toEqual([])
})

it('requires an exact root manifest path for literal manifest matches', async () => {
  const db = database()
  const result = await discover(
    db,
    reader(async (query) => {
      if (query.startsWith('.claude-plugin/marketplace.json')) {
        return page([
          item('https://github.com/acme/nested-literal-match', null, 'plugins/.claude-plugin/marketplace.json'),
          item('https://github.com/acme/case-variant', null, '.CLAUDE-PLUGIN/marketplace.json'),
        ])
      }
      return page([])
    }),
    'run-1',
    [firstRange],
  )

  expect(result.newUrls).toBe(0)
  expect(db.prepare('SELECT html_url FROM repositories').all()).toEqual([])
})

it('deduplicates case-variant URLs across families before upserting them again', async () => {
  const db = database()
  const duplicate = 'https://github.com/owner/repeated'
  db.exec(`
    CREATE TABLE upsert_count (count INTEGER NOT NULL);
    INSERT INTO upsert_count VALUES (0);
    CREATE TRIGGER count_repository_insert AFTER INSERT ON repositories BEGIN
      UPDATE upsert_count SET count = count + 1;
    END;
    CREATE TRIGGER count_repository_update AFTER UPDATE ON repositories BEGIN
      UPDATE upsert_count SET count = count + 1;
    END;
  `)

  const result = await discover(
    db,
    reader(async (query) =>
      query.startsWith('filename:') ? page([item(duplicate, 'first')]) : page([item('https://github.com/OWNER/REPEATED', 'second')]),
    ),
    'run-1',
    [[0, 10]],
  )

  expect(result).toMatchObject({ newUrls: 1, existingUrls: 0 })
  expect(db.prepare('SELECT count FROM upsert_count').get()).toEqual({ count: 1 })
  expect(db.prepare('SELECT description FROM repositories WHERE html_url = ?').get(duplicate)).toEqual({ description: 'first' })
})

it('tags warnings with their family and preserves that family cache while later families continue', async () => {
  const db = database()
  db.prepare(`
    INSERT INTO discovery_ranges (query_family, root_start, root_end, range_start, range_end)
    VALUES ('marketplace_filename_path', 0, 1, 0, 0), ('marketplace_filename_path', 0, 1, 1, 1)
  `).run()
  const calls: string[] = []
  const logs: Array<Record<string, unknown>> = []
  const result = await discover(
    db,
    reader(async (query) => {
      calls.push(query)
      if (query === 'filename:marketplace.json path:.claude-plugin size:0..0') {
        throw new GitHubTemporaryError('Retries exhausted', 503, 2)
      }
      return page([])
    }),
    'run-1',
    [[0, 1]],
    undefined,
    undefined,
    (entry) => logs.push(entry),
  )

  expect(calls).toEqual([
    'filename:marketplace.json path:.claude-plugin size:0..0',
    'filename:marketplace.json path:.claude-plugin size:1..1',
    '.claude-plugin/marketplace.json in:path size:0..1',
  ])
  expect(
    db
      .prepare(`
    SELECT query_family, range_start, range_end FROM discovery_ranges
    WHERE query_family = 'marketplace_filename_path' ORDER BY range_start
  `)
      .all(),
  ).toEqual([
    { query_family: 'marketplace_filename_path', range_start: 0, range_end: 0 },
    { query_family: 'marketplace_filename_path', range_start: 1, range_end: 1 },
  ])
  expect(listRunErrors(db, 'run-1').map(({ query_family, error_type }) => ({ query_family, error_type }))).toEqual([
    { query_family: 'marketplace_filename_path', error_type: 'temporary-error' },
  ])
  expect(result.warnings).toEqual([{ range: [0, 0], category: 'temporary-error', query_family: 'marketplace_filename_path' }])
  expect(result.families.marketplace_filename_path.warningCount).toBe(1)
  expect(logs.map(({ query_family }) => query_family)).toEqual(['marketplace_filename_path'])
})

it('keeps aggregate and family success counts aligned when a family range splits', async () => {
  const db = database()
  const result = await discover(
    db,
    reader(async (query) => {
      if (query === 'filename:marketplace.json path:.claude-plugin size:0..3') return page([], 1_000)
      return page([])
    }),
    'run-1',
    [[0, 3]],
  )

  expect(result.successfulRanges).toBe(3)
  expect(result.families).toEqual({
    marketplace_filename_path: { successfulRanges: 2, warningCount: 0 },
    marketplace_path_literal: { successfulRanges: 1, warningCount: 0 },
  })
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

  expect(visited).toEqual([1, 2, 1, 2])
  expect(result).toMatchObject({ newUrls: 101, existingUrls: 0, successfulRanges: 2, warningCount: 0 })
  expect(db.prepare('SELECT COUNT(*) AS count FROM repositories').get()).toEqual({ count: 101 })
})

it('continues past a short page when total_count says more results remain', async () => {
  const db = database()
  const visited: number[] = []
  const result = await discover(
    db,
    reader(async (_query, number) => {
      visited.push(number)
      if (number === 1)
        return page(
          Array.from({ length: 40 }, (_, i) => item(`https://github.com/owner/first-${i}`)),
          140,
        )
      if (number === 2)
        return page(
          Array.from({ length: 100 }, (_, i) => item(`https://github.com/owner/second-${i}`)),
          140,
        )
      throw new Error('Unexpected extra page')
    }),
    'run-1',
    [firstRange],
  )

  expect(visited).toEqual([1, 1, 2, 1, 1, 2])
  expect(result).toMatchObject({ newUrls: 140, successfulRanges: 2, warningCount: 0 })
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

  expect(visited).toEqual([1, 1])
  expect(result).toMatchObject({ newUrls: 100, successfulRanges: 2, warningCount: 0 })
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

  expect(marketplaceQueries(queries)).toEqual([
    'filename:marketplace.json path:.claude-plugin size:0..3',
    'filename:marketplace.json path:.claude-plugin size:0..1',
    'filename:marketplace.json path:.claude-plugin size:2..3',
  ])
  expect(result).toMatchObject({ newUrls: 2, successfulRanges: 4, warningCount: 0 })
})

it('reuses persisted terminal size ranges instead of probing the saturated parent again', async () => {
  const db = database()
  const firstCalls: string[] = []
  await discover(
    db,
    reader(async (query) => {
      firstCalls.push(query)
      if (query.endsWith('0..3')) return page([], 1_000)
      if (query.endsWith('0..1')) return page([item('https://github.com/owner/small')])
      if (query.endsWith('2..3')) return page([item('https://github.com/owner/large')])
      throw new Error(`Unexpected range: ${query}`)
    }),
    'run-1',
    [[0, 3]],
  )

  expect(marketplaceQueries(firstCalls)).toEqual([
    'filename:marketplace.json path:.claude-plugin size:0..3',
    'filename:marketplace.json path:.claude-plugin size:0..1',
    'filename:marketplace.json path:.claude-plugin size:2..3',
  ])

  const secondCalls: string[] = []
  await discover(
    db,
    reader(async (query) => {
      secondCalls.push(query)
      if (query.endsWith('0..1')) return page([item('https://github.com/owner/small')])
      if (query.endsWith('2..3')) return page([item('https://github.com/owner/large')])
      throw new Error(`Cached discovery unexpectedly probed: ${query}`)
    }),
    'run-1',
    [[0, 3]],
  )

  expect(marketplaceQueries(secondCalls)).toEqual([
    'filename:marketplace.json path:.claude-plugin size:0..1',
    'filename:marketplace.json path:.claude-plugin size:2..3',
  ])
  expect(
    db
      .prepare(
        "SELECT root_start, root_end, range_start, range_end FROM discovery_ranges WHERE query_family = 'marketplace_filename_path' ORDER BY range_start",
      )
      .all(),
  ).toEqual([
    { root_start: 0, root_end: 3, range_start: 0, range_end: 1 },
    { root_start: 0, root_end: 3, range_start: 2, range_end: 3 },
  ])
})

it('keeps the previous cached partition when a refined child range fails temporarily', async () => {
  const db = database()
  await discover(
    db,
    reader(async (query) => {
      if (query.endsWith('0..3')) return page([], 1_000)
      if (query.endsWith('0..1')) return page([item('https://github.com/owner/small')])
      if (query.endsWith('2..3')) return page([item('https://github.com/owner/large')])
      throw new Error(`Unexpected range: ${query}`)
    }),
    'run-1',
    [[0, 3]],
  )

  await discover(
    db,
    reader(async (query) => {
      if (query.endsWith('0..1')) return page([], 1_000)
      if (query.endsWith('0..0')) return page([item('https://github.com/owner/tiny')])
      if (query.endsWith('1..1')) throw new GitHubTemporaryError('Retries exhausted', 503, 3)
      if (query.endsWith('2..3')) return page([item('https://github.com/owner/large')])
      throw new Error(`Unexpected range: ${query}`)
    }),
    'run-1',
    [[0, 3]],
  )

  expect(
    db
      .prepare(
        "SELECT root_start, root_end, range_start, range_end FROM discovery_ranges WHERE query_family = 'marketplace_filename_path' ORDER BY range_start",
      )
      .all(),
  ).toEqual([
    { root_start: 0, root_end: 3, range_start: 0, range_end: 1 },
    { root_start: 0, root_end: 3, range_start: 2, range_end: 3 },
  ])
})

it('counts a URL only once when a parent page is replayed by split child ranges', async () => {
  const db = database()
  const duplicate = 'https://github.com/owner/duplicate'
  const result = await discover(
    db,
    reader(async (query, number) => {
      if (query.endsWith('0..3') && number === 1) return page([item(duplicate)], 1_000)
      if (query.endsWith('0..1')) return page([item(duplicate)])
      if (query.endsWith('2..3')) return page([item('https://github.com/owner/unique')])
      throw new Error(`Unexpected request: ${query} page ${number}`)
    }),
    'run-1',
    [[0, 3]],
  )

  expect(result).toMatchObject({ newUrls: 2, existingUrls: 0, successfulRanges: 4 })
  expect(db.prepare('SELECT COUNT(*) AS count FROM repositories').get()).toEqual({ count: 2 })
})

it('splits a range when a later page reports saturation even if that page is short', async () => {
  const db = database()
  const calls: Array<[string, number]> = []
  const result = await discover(
    db,
    reader(async (query, number) => {
      calls.push([query, number])
      if (query.endsWith('0..3') && number === 1) {
        return page(
          Array.from({ length: 100 }, (_, i) => item(`https://github.com/owner/parent-${i}`)),
          999,
        )
      }
      if (query.endsWith('0..3') && number === 2) {
        return page(
          Array.from({ length: 20 }, (_, i) => item(`https://github.com/owner/late-${i}`)),
          1_000,
        )
      }
      if (query.endsWith('0..1')) return page([item('https://github.com/owner/small')])
      if (query.endsWith('2..3')) return page([item('https://github.com/owner/large')])
      throw new Error(`Unexpected range: ${query}`)
    }),
    'run-1',
    [[0, 3]],
  )

  expect(marketplaceCalls(calls)).toEqual([
    ['filename:marketplace.json path:.claude-plugin size:0..3', 1],
    ['filename:marketplace.json path:.claude-plugin size:0..3', 2],
    ['filename:marketplace.json path:.claude-plugin size:0..1', 1],
    ['filename:marketplace.json path:.claude-plugin size:2..3', 1],
  ])
  expect(result).toMatchObject({ newUrls: 102, successfulRanges: 4, warningCount: 0 })
  expect(errors(db)).toEqual([])
})

it('splits a range when page ten is full even if the first total_count was below the cap', async () => {
  const db = database()
  const calls: Array<[string, number]> = []
  const result = await discover(
    db,
    reader(async (query, number) => {
      calls.push([query, number])
      if (query.endsWith('0..3'))
        return page(
          Array.from({ length: 100 }, (_, i) => item(`https://github.com/owner/parent-${number}-${i}`)),
          999,
        )
      if (query.endsWith('0..1')) return page([item('https://github.com/owner/small')])
      if (query.endsWith('2..3')) return page([item('https://github.com/owner/large')])
      throw new Error(`Unexpected range: ${query}`)
    }),
    'run-1',
    [[0, 3]],
  )

  expect(marketplaceCalls(calls)).toEqual([
    ...Array.from({ length: 10 }, (_, i) => ['filename:marketplace.json path:.claude-plugin size:0..3', i + 1] as [string, number]),
    ['filename:marketplace.json path:.claude-plugin size:0..1', 1],
    ['filename:marketplace.json path:.claude-plugin size:2..3', 1],
  ])
  expect(result).toMatchObject({ newUrls: 1002, successfulRanges: 4, warningCount: 0 })
  expect(errors(db)).toEqual([])
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

    expect(visited).toEqual([
      ...Array.from({ length: 10 }, (_, index) => index + 1),
      ...Array.from({ length: 10 }, (_, index) => index + 1),
    ])
    expect(result).toMatchObject({ newUrls: 1000, existingUrls: 0, successfulRanges: 2, warningCount: 4 })
    expect(errors(db)).toEqual([
      { phase: 'search', range_start: 0, range_end: 0, error_type: 'saturated' },
      { phase: 'search', range_start: 0, range_end: 0, error_type: 'page-limit' },
    ])
  },
)

it('retries incomplete results and splits the range before accepting coverage', async () => {
  const db = database()
  const calls: string[] = []
  const result = await discover(
    db,
    reader(async (query) => {
      calls.push(query)
      if (query.endsWith('150..200')) return page([], 0, true)
      if (query.endsWith('150..175')) return page([item('https://github.com/owner/left')])
      if (query.endsWith('176..200')) return page([item('https://github.com/owner/right')])
      throw new Error(`Unexpected range: ${query}`)
    }),
    'run-1',
    [secondRange],
  )

  expect(marketplaceQueries(calls)).toEqual([
    'filename:marketplace.json path:.claude-plugin size:150..200',
    'filename:marketplace.json path:.claude-plugin size:150..200',
    'filename:marketplace.json path:.claude-plugin size:150..200',
    'filename:marketplace.json path:.claude-plugin size:150..175',
    'filename:marketplace.json path:.claude-plugin size:176..200',
  ])
  expect(result).toMatchObject({ successfulRanges: 4, newUrls: 2, warningCount: 2 })
  expect(errors(db)).toEqual([{ phase: 'search', range_start: 150, range_end: 200, error_type: 'incomplete-results' }])
})

it('retries a short Code Search page and splits the range if pagination still underfetches', async () => {
  const db = database()
  const calls: Array<[string, number]> = []
  const result = await discover(
    db,
    reader(async (query, number) => {
      calls.push([query, number])
      if (query.endsWith('0..3') && number === 1) return page([item('https://github.com/owner/partial')], 5)
      if (query.endsWith('0..3')) return page([], 5)
      if (query.endsWith('0..1')) return page([item('https://github.com/owner/left')])
      if (query.endsWith('2..3')) return page([item('https://github.com/owner/right')])
      throw new Error(`Unexpected request: ${query} page ${number}`)
    }),
    'run-1',
    [[0, 3]],
  )

  expect(marketplaceCalls(calls)).toEqual([
    ['filename:marketplace.json path:.claude-plugin size:0..3', 1],
    ['filename:marketplace.json path:.claude-plugin size:0..3', 1],
    ['filename:marketplace.json path:.claude-plugin size:0..3', 2],
    ['filename:marketplace.json path:.claude-plugin size:0..3', 2],
    ['filename:marketplace.json path:.claude-plugin size:0..1', 1],
    ['filename:marketplace.json path:.claude-plugin size:2..3', 1],
  ])
  expect(result).toMatchObject({ newUrls: 3, successfulRanges: 4, warningCount: 2 })
  expect(errors(db)).toEqual([{ phase: 'search', range_start: 0, range_end: 3, error_type: 'short-page' }])
})

it('records an unsplittable incomplete range and continues with later ranges', async () => {
  const db = database()
  const calls: string[] = []
  const result = await discover(
    db,
    reader(async (query) => {
      calls.push(query)
      if (query.endsWith('0..0')) return page([], 0, true)
      if (query.endsWith('1..1')) return page([item('https://github.com/owner/next')])
      throw new Error(`Unexpected range: ${query}`)
    }),
    'run-1',
    [
      [0, 0],
      [1, 1],
    ],
  )

  expect(marketplaceQueries(calls)).toEqual([
    'filename:marketplace.json path:.claude-plugin size:0..0',
    'filename:marketplace.json path:.claude-plugin size:0..0',
    'filename:marketplace.json path:.claude-plugin size:0..0',
    'filename:marketplace.json path:.claude-plugin size:1..1',
  ])
  expect(result).toMatchObject({ successfulRanges: 2, newUrls: 1, warningCount: 2 })
  expect(errors(db)).toEqual([{ phase: 'search', range_start: 0, range_end: 0, error_type: 'incomplete-results' }])
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

  expect(result).toMatchObject({ newUrls: 1, existingUrls: 1, successfulRanges: 4, warningCount: 0 })
  expect(db.prepare('SELECT id, description, stargazers_count FROM repositories WHERE html_url = ?').get(enrichedUrl)).toEqual({
    id: originalId,
    description: 'authoritative REST description',
    stargazers_count: 10,
  })
  expect(db.prepare('SELECT description FROM repositories WHERE html_url = ?').get(pendingUrl)).toEqual({
    description: 'first description',
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

  expect(result).toMatchObject({ newUrls: 0, existingUrls: 1, successfulRanges: 2, warningCount: 0 })
  expect(db.prepare('SELECT id, html_url FROM repositories').all()).toEqual([{ id, html_url: 'https://github.com/team/repo' }])
})

it('persists the repository node ID returned by Code Search', async () => {
  const db = database()
  await discover(
    db,
    reader(async () =>
      page([
        {
          path: '.claude-plugin/marketplace.json',
          repository: { html_url: 'https://github.com/team/repo', description: 'repo', node_id: 'MDEwOlJlcG9zaXRvcnkx' },
        },
      ]),
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
        {
          path: '.claude-plugin/marketplace.json',
          repository: { html_url: 'https://github.com/owner/private', description: 'secret', private: true },
        },
        item('https://github.com/owner/public', 'public'),
      ]),
    ),
    'run-1',
    [firstRange],
  )

  expect(result).toMatchObject({ newUrls: 1, existingUrls: 0, successfulRanges: 2, warningCount: 0 })
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

  expect(result).toMatchObject({ newUrls: 1, existingUrls: 0, successfulRanges: 2, warningCount: 2 })
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

  expect(visited.map(([, number]) => number)).toEqual([1, 2, 1, 1, 2, 1])
  expect(result).toMatchObject({ newUrls: 101, successfulRanges: 4, warningCount: 2 })
  expect(errors(db)).toEqual([{ phase: 'search', range_start: 0, range_end: 150, error_type: 'temporary-error' }])
  expect(
    listRunErrors(db, 'run-1')
      .filter(({ query_family }) => query_family === 'marketplace_filename_path')
      .map(({ retry_count }) => retry_count),
  ).toEqual([3])
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

  expect(result).toMatchObject({ newUrls: 0, existingUrls: 0, successfulRanges: 0, warningCount: 4 })
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
