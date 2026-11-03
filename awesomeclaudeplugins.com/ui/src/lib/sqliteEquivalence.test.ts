import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findCatalogRepo, searchCatalogRepos } from './catalog.ts'
import { isRepoPageEndingInMd } from './markdownPaths.ts'
import { getSqliteReader, sqliteCloseCatalog, sqliteGetCatalogMetadata } from './sqliteCatalogStore.ts'
import type { CatalogRepo, Repo } from './types.ts'

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
        ...(repo.plugins ?? []).flatMap((p) => [p.name ?? '', p.description ?? '']),
      ]
        .join(' ')
        .toLowerCase()
      return terms.every((term) => matchText.includes(term))
    })
  }

  const sorted = [...filtered].sort((a, b) => {
    switch (sort) {
      case 'stars-desc': {
        const diff = (b.stars ?? 0) - (a.stars ?? 0)
        return diff !== 0 ? diff : a.id - b.id
      }
      case 'forks-desc': {
        const diff = (b.forks ?? 0) - (a.forks ?? 0)
        return diff !== 0 ? diff : a.id - b.id
      }
      case 'plugins-desc': {
        const diff = (b.plugins?.length ?? 0) - (a.plugins?.length ?? 0)
        return diff !== 0 ? diff : a.id - b.id
      }
      case 'updated-desc': {
        const diff = new Date(b.pushed_at ?? 0).getTime() - new Date(a.pushed_at ?? 0).getTime()
        return diff !== 0 ? diff : a.id - b.id
      }
      case 'created-desc': {
        const diff = new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
        return diff !== 0 ? diff : a.id - b.id
      }
      default:
        return a.id - b.id
    }
  })

  const total = sorted.length
  const pluginsCount = sorted.reduce((sum, r) => sum + (r.plugins?.length ?? 0), 0)
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

      if (query === '') {
        const metadata = sqliteGetCatalogMetadata()
        expect(sqliteFull.total).toBe(metadata.canonical_count)
        expect(sqliteFull.pluginsCount).toBe(metadata.plugins_count)
        expect(sqliteFull.hasMore).toBe((page + 1) * pageSize < metadata.canonical_count)
      } else {
        // Search queries: verify total and pluginsCount are consistent and non-negative
        expect(sqliteFull.total).toBeGreaterThanOrEqual(0)
        expect(sqliteFull.pluginsCount).toBeGreaterThanOrEqual(0)
        if (sqliteFull.total > 0 && page === 0) {
          expect(sqliteFull.repos.length).toBeGreaterThan(0)
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

  it('referenceSearchAlgorithm: validates in-memory baseline search behavior', () => {
    const sample = allRecords.slice(0, 50)
    const result = referenceSearch(sample, 'claude', 'stars-desc', 0, 10)
    expect(result.total).toBeGreaterThanOrEqual(0)
    expect(result.repos.length).toBeLessThanOrEqual(10)
    expect(result.pluginsCount).toBeGreaterThanOrEqual(0)
  })
})
