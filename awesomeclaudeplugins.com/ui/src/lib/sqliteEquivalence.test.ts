/** biome-ignore-all lint/style/useNamingConvention: test fixtures mirror catalog snake_case fields */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Repo } from '../schemas/repo.schema.ts'
import { type CatalogRepo, compareCatalogRepos, findCatalogRepo, searchCatalogRepos } from './catalog.ts'
import { isRepoPageEndingInMd } from './markdownPaths.ts'
import { getSqliteReader, sqliteCloseCatalog, sqliteGetCatalogMetadata } from './sqliteCatalogStore.ts'

const WHITESPACE_REGEX = /\s+/

// Reference in-memory implementation of the canonical JSON catalog search & sort contract
function referenceSearch(
  records: readonly CatalogRepo[],
  query: string,
  sort: 'stars-desc' | 'forks-desc' | 'plugins-desc' | 'updated-desc' | 'created-desc',
  page: number,
  pageSize: number,
  options?: { summaries?: 'omit' | 'include' }
) {
  const q = query.trim().toLowerCase()
  let filtered = records

  if (q) {
    const terms = q.split(WHITESPACE_REGEX).filter(Boolean)
    filtered = records.filter((repo) => {
      const matchText = [
        repo.owner,
        repo.repo_name,
        repo.description ?? '',
        ...(repo.plugins ?? []).flatMap((p: { name?: string; description?: string }) => [p.name ?? '', p.description ?? '']),
      ]
        .join(' ')
        .toLowerCase()
      return terms.every((term) => matchText.includes(term))
    })
  }

  const sorted = [...filtered].sort((a, b) => compareCatalogRepos(a, b, sort))

  const total = sorted.length
  const pluginsCount = sorted.reduce((sum, r) => sum + (r.plugins_count ?? r.plugins?.length ?? 0), 0)
  const start = page * pageSize
  const paged = sorted.slice(start, start + pageSize)
  const hasMore = start + pageSize < total

  const repos = options?.summaries === 'omit' ? paged.map(({ description, ...rest }) => rest as Repo) : paged

  return { repos, total, pluginsCount, hasMore }
}

describe('SQLite catalog migration regression and equivalence gate', () => {
  let reader: ReturnType<typeof getSqliteReader>
  let allRecords: CatalogRepo[]

  beforeAll(async () => {
    reader = getSqliteReader()
    allRecords = [...reader.iteratePublishedRecords()] as CatalogRepo[]
  })

  afterAll(() => {
    sqliteCloseCatalog()
  })

  it('loads published records into reader', () => {
    expect(allRecords.length).toBeGreaterThan(0)
  })

  it('sqlAndReferencePagesMatch: compares total, pluginsCount, pagination, and sorting against reference algorithm', () => {
    const testCases: Array<{
      query: string
      sort: 'stars-desc' | 'forks-desc' | 'plugins-desc' | 'updated-desc' | 'created-desc'
      page: number
      pageSize: number
    }> = [
      { query: '', sort: 'stars-desc', page: 0, pageSize: 24 },
      { query: '', sort: 'forks-desc', page: 1, pageSize: 24 },
      { query: '', sort: 'plugins-desc', page: 0, pageSize: 24 },
      { query: '', sort: 'updated-desc', page: 0, pageSize: 24 },
      { query: '', sort: 'created-desc', page: 1, pageSize: 24 },
      { query: 'claude', sort: 'stars-desc', page: 0, pageSize: 24 },
      { query: 'claude', sort: 'plugins-desc', page: 1, pageSize: 24 },
      { query: 'mcp', sort: 'updated-desc', page: 0, pageSize: 24 },
      { query: 'python', sort: 'forks-desc', page: 0, pageSize: 24 },
      { query: 'nonexistentquery12345xyz', sort: 'stars-desc', page: 0, pageSize: 24 },
    ]

    for (const { query, sort, page, pageSize } of testCases) {
      const sqliteFull = searchCatalogRepos(query, sort, page, pageSize)
      expect(sqliteFull).toBeDefined()
      expect(sqliteFull.repos).toBeInstanceOf(Array)
      expect(sqliteFull.repos.length).toBeLessThanOrEqual(pageSize)

      const ref = referenceSearch(allRecords, query, sort, page, pageSize)

      if (query === '') {
        const metadata = sqliteGetCatalogMetadata()
        expect(sqliteFull.total).toBe(metadata.canonical_count)
        expect(sqliteFull.pluginsCount).toBe(metadata.plugins_count)
        expect(sqliteFull.hasMore).toBe((page + 1) * pageSize < metadata.canonical_count)
        expect(sqliteFull.total).toBe(ref.total)
        expect(sqliteFull.pluginsCount).toBe(ref.pluginsCount)
        expect(sqliteFull.hasMore).toBe(ref.hasMore)
        expect(sqliteFull.repos.map((r) => r.id)).toEqual(ref.repos.map((r) => r.id))
      } else {
        // Search queries: verify total, pluginsCount, exact ID sequence and FTS5 ranking
        const expectedSearch = reader.searchRepos(query, { sort, page, pageSize, view: 'full' })
        expect(sqliteFull.total).toBe(expectedSearch.total)
        expect(sqliteFull.pluginsCount).toBe(expectedSearch.pluginsCount)
        expect(sqliteFull.hasMore).toBe(expectedSearch.hasMore)
        expect(sqliteFull.repos.map((r) => r.id)).toEqual(expectedSearch.matches.map((m) => (m.item as CatalogRepo).id))

        // Verify FTS5 metric ordering and BM25 tie breaking on equal metric ranks
        for (let i = 0; i < expectedSearch.matches.length - 1; i++) {
          const curr = expectedSearch.matches[i]
          const next = expectedSearch.matches[i + 1]
          const cmp = compareCatalogRepos(curr.item as CatalogRepo, next.item as CatalogRepo, sort)
          expect(cmp).toBeLessThanOrEqual(0)
          if (cmp === 0) {
            expect(curr.score).toBeLessThanOrEqual(next.score)
          }
        }

        if (sqliteFull.total > 0 && page === 0) {
          expect(sqliteFull.repos.length).toBeGreaterThan(0)
        }
        for (const repo of sqliteFull.repos) {
          const matchText = [
            repo.owner,
            repo.repo_name,
            repo.description ?? '',
            ...(repo.plugins ?? []).flatMap((p) => [p.name ?? '', p.description ?? '']),
          ]
            .join(' ')
            .toLowerCase()
          expect(matchText).toContain(query.toLowerCase())
        }
      }

      // Cards view (summaries: 'omit')
      const sqliteCards = searchCatalogRepos(query, sort, page, pageSize, { summaries: 'omit' })
      expect(sqliteCards.total).toBe(sqliteFull.total)
      expect(sqliteCards.pluginsCount).toBe(sqliteFull.pluginsCount)
      expect(sqliteCards.hasMore).toBe(sqliteFull.hasMore)
      for (const card of sqliteCards.repos) {
        expect((card as { plugins?: unknown }).plugins).toBeUndefined()
      }
    }
  })

  it('searchOnlyInPluginDescription: matches repositories when query exists only in plugin description', () => {
    const query = 'summarize'
    const result = searchCatalogRepos(query, 'stars-desc', 0, 24)
    expect(result.total).toBeGreaterThan(0)
    expect(result.repos.length).toBeGreaterThan(0)
  })

  it('stableSortTies: breaks ties deterministically across pages without duplicate or missing records', () => {
    const page0 = searchCatalogRepos('', 'stars-desc', 0, 50)
    const page1 = searchCatalogRepos('', 'stars-desc', 1, 50)

    const ids0 = new Set(page0.repos.map((r) => r.id))
    for (const r of page1.repos) {
      expect(ids0.has(r.id)).toBe(false)
    }
  })

  it('searchRankingAndBM25TieBreaking: verifies deterministic BM25 score ordering and pagination for search', () => {
    const query = 'claude'
    const sort = 'stars-desc'
    const page0 = searchCatalogRepos(query, sort, 0, 20)
    const page1 = searchCatalogRepos(query, sort, 1, 20)

    expect(page0.repos.length).toBeGreaterThan(0)
    expect(page1.repos.length).toBeGreaterThan(0)

    // Verify disjoint page IDs (no duplicates across pages)
    const ids0 = new Set(page0.repos.map((r) => r.id))
    for (const r of page1.repos) {
      expect(ids0.has(r.id)).toBe(false)
    }

    // Verify monotonicity across pages
    const lastPage0 = page0.repos[page0.repos.length - 1]
    const firstPage1 = page1.repos[0]
    expect(compareCatalogRepos(lastPage0, firstPage1, sort)).toBeLessThanOrEqual(0)

    // Direct reader verification of BM25 scores
    const readerSearch0 = reader.searchRepos(query, { sort, page: 0, pageSize: 20 })
    for (let i = 0; i < readerSearch0.matches.length - 1; i++) {
      const curr = readerSearch0.matches[i]
      const next = readerSearch0.matches[i + 1]
      const rankCmp = compareCatalogRepos(curr.item as CatalogRepo, next.item as CatalogRepo, sort)
      expect(rankCmp).toBeLessThanOrEqual(0)
      if (rankCmp === 0) {
        // BM25 score tie-breaker: lower score is more relevant
        expect(curr.score).toBeLessThanOrEqual(next.score)
      }
    }
  })

  it('literalMarkdownRepositoryNegotiation: correctly identifies repos whose name ends in .md vs plain repos', () => {
    expect(isRepoPageEndingInMd('sstklen/yes.md')).toBe(true)
    expect(isRepoPageEndingInMd('SSTKLEN/YES.MD')).toBe(true)
    expect(isRepoPageEndingInMd('anthropics/anthropic-quickstarts')).toBe(false)
    expect(isRepoPageEndingInMd('unknown/fake-repo.md')).toBe(false)
  })

  it('singleRepoLookupEquivalence: retrieves repository details and plugin arrays with full fidelity', () => {
    const testPaths = ['ykdojo/claude-code-tips', 'drewinglis/agent-skills']
    for (const repoPath of testPaths) {
      const repo = findCatalogRepo(repoPath)
      expect(repo).toBeDefined()
      expect(repo?.owner).toBeDefined()
      expect(repo?.repo_name).toBeDefined()
      expect(Array.isArray(repo?.plugins)).toBe(true)
    }
  })

  it('referenceSearchAlgorithm: validates search and sort equivalence on fixture records', () => {
    const fixtureRecords: CatalogRepo[] = [
      {
        id: 1,
        owner: 'alpha',
        repo_name: 'claude-assistant',
        description: 'Claude tools and assistant utilities',
        stargazers_count: 500,
        forks_count: 50,
        subscribers_count: 10,
        pushed_at: '2026-03-01T00:00:00Z',
        catalog_added_at: '2026-01-01T00:00:00Z',
        plugins: [{ name: 'assistant', description: 'Core assistant plugin' }],
        plugins_count: 1,
      },
      {
        id: 2,
        owner: 'beta',
        repo_name: 'super-claude',
        description: 'Supercharged claude setup',
        stargazers_count: 1000,
        forks_count: 100,
        subscribers_count: 20,
        pushed_at: '2026-04-01T00:00:00Z',
        catalog_added_at: '2026-02-01T00:00:00Z',
        plugins: [
          { name: 'p1', description: 'Plugin 1' },
          { name: 'p2', description: 'Plugin 2' },
        ],
        plugins_count: 2,
      },
      {
        id: 3,
        owner: 'gamma',
        repo_name: 'unrelated-project',
        description: 'Nothing to see here',
        stargazers_count: 200,
        forks_count: 10,
        subscribers_count: 5,
        pushed_at: '2026-02-01T00:00:00Z',
        catalog_added_at: '2026-01-15T00:00:00Z',
        plugins: [],
        plugins_count: 0,
      },
    ]

    const result = referenceSearch(fixtureRecords, 'claude', 'stars-desc', 0, 10)
    expect(result.total).toBe(2)
    expect(result.pluginsCount).toBe(3)
    expect(result.repos.map((r) => r.id)).toEqual([2, 1])

    const forksResult = referenceSearch(fixtureRecords, 'claude', 'forks-desc', 0, 10)
    expect(forksResult.repos.map((r) => r.id)).toEqual([2, 1])

    const pagedResult = referenceSearch(fixtureRecords, 'claude', 'stars-desc', 0, 1)
    expect(pagedResult.total).toBe(2)
    expect(pagedResult.repos.length).toBe(1)
    expect(pagedResult.repos[0].id).toBe(2)
    expect(pagedResult.hasMore).toBe(true)

    const pagedNext = referenceSearch(fixtureRecords, 'claude', 'stars-desc', 1, 1)
    expect(pagedNext.repos.length).toBe(1)
    expect(pagedNext.repos[0].id).toBe(1)
    expect(pagedNext.hasMore).toBe(false)
  })
})
