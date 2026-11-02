import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findCatalogRepo, searchCatalogRepos } from './catalog.ts'
import { isRepoPageEndingInMd } from './markdownPaths.ts'
import { sqliteCloseCatalog } from './sqliteCatalogStore.ts'

describe('PR 2 SQLite migration equivalence tests', () => {
  const originalBackend = process.env.CATALOG_BACKEND

  beforeAll(async () => {
    const { prepareCatalog } = await import('../../scripts/prepare-catalog.mjs')
    await prepareCatalog()
  }, 30000)

  afterAll(() => {
    if (originalBackend !== undefined) {
      process.env.CATALOG_BACKEND = originalBackend
    } else {
      delete process.env.CATALOG_BACKEND
    }
    sqliteCloseCatalog()
  })

  it('sqlAndLegacyPagesMatch: compares ordered paths, full API payload, total, pluginsCount, hasMore, default/full vs cards', () => {
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
      process.env.CATALOG_BACKEND = 'legacy-json'
      const legacyFull = searchCatalogRepos(query, sort, page, pageSize)

      process.env.CATALOG_BACKEND = 'sqlite'
      const sqliteFull = searchCatalogRepos(query, sort, page, pageSize)

      expect(sqliteFull.total).toBe(legacyFull.total)
      expect(sqliteFull.pluginsCount).toBe(legacyFull.pluginsCount)
      expect(sqliteFull.hasMore).toBe(legacyFull.hasMore)

      const legacyFullPaths = legacyFull.repos.map((r) => `${r.owner}/${r.repo_name}`.toLowerCase())
      const sqliteFullPaths = sqliteFull.repos.map((r) => `${r.owner}/${r.repo_name}`.toLowerCase())
      expect(sqliteFullPaths).toEqual(legacyFullPaths)

      // Compare full API payloads
      expect(sqliteFull.repos).toEqual(legacyFull.repos)

      // 2. Cards view (view=cards / summaries: 'omit')
      process.env.CATALOG_BACKEND = 'legacy-json'
      const legacyCards = searchCatalogRepos(query, sort, page, pageSize, { summaries: 'omit' })

      process.env.CATALOG_BACKEND = 'sqlite'
      const sqliteCards = searchCatalogRepos(query, sort, page, pageSize, { summaries: 'omit' })

      expect(sqliteCards.total).toBe(legacyCards.total)
      expect(sqliteCards.pluginsCount).toBe(legacyCards.pluginsCount)
      expect(sqliteCards.hasMore).toBe(legacyCards.hasMore)

      const legacyCardPaths = legacyCards.repos.map((r) => `${r.owner}/${r.repo_name}`.toLowerCase())
      const sqliteCardPaths = sqliteCards.repos.map((r) => `${r.owner}/${r.repo_name}`.toLowerCase())
      expect(sqliteCardPaths).toEqual(legacyCardPaths)
      expect(sqliteCards.repos).toEqual(legacyCards.repos)
    }
  }, 30000)

  it('searchOnlyInPluginDescription: matches repositories when query exists only in plugin description', () => {
    const query = 'summarize'
    process.env.CATALOG_BACKEND = 'legacy-json'
    const legacy = searchCatalogRepos(query, 'stars-desc', 0, 24)

    process.env.CATALOG_BACKEND = 'sqlite'
    const sqlite = searchCatalogRepos(query, 'stars-desc', 0, 24)

    expect(sqlite.total).toBe(legacy.total)
    expect(sqlite.pluginsCount).toBe(legacy.pluginsCount)
    expect(sqlite.repos.map((r) => `${r.owner}/${r.repo_name}`.toLowerCase())).toEqual(
      legacy.repos.map((r) => `${r.owner}/${r.repo_name}`.toLowerCase())
    )
    expect(sqlite.repos).toEqual(legacy.repos)
  })

  it('stableSortTies: breaks ties identically using source_order ASC', () => {
    process.env.CATALOG_BACKEND = 'legacy-json'
    const legacyTies = searchCatalogRepos('', 'stars-desc', 50, 50)

    process.env.CATALOG_BACKEND = 'sqlite'
    const sqliteTies = searchCatalogRepos('', 'stars-desc', 50, 50)

    expect(sqliteTies.total).toBe(legacyTies.total)
    expect(sqliteTies.repos.map((r) => `${r.owner}/${r.repo_name}`.toLowerCase())).toEqual(
      legacyTies.repos.map((r) => `${r.owner}/${r.repo_name}`.toLowerCase())
    )
  })

  it('literalMarkdownRepositoryNegotiation: correctly identifies repos whose name ends in .md vs plain repos in both backends', () => {
    for (const backend of ['legacy-json', 'sqlite'] as const) {
      process.env.CATALOG_BACKEND = backend
      expect(isRepoPageEndingInMd('sstklen/yes.md')).toBe(true)
      expect(isRepoPageEndingInMd('SSTKLEN/YES.MD')).toBe(true)

      expect(isRepoPageEndingInMd('anthropics/anthropic-quickstarts')).toBe(false)
      expect(isRepoPageEndingInMd('unknown/fake-repo.md')).toBe(false)
    }
  })

  it('standaloneInstallUnchanged: preserves standalone plugin manifests and install commands', () => {
    const standaloneRepoPath = 'wshxbqq/claude-plugins'
    process.env.CATALOG_BACKEND = 'legacy-json'
    const legacyRepo = findCatalogRepo(standaloneRepoPath)

    process.env.CATALOG_BACKEND = 'sqlite'
    const sqliteRepo = findCatalogRepo(standaloneRepoPath)

    if (legacyRepo) {
      expect(sqliteRepo).toBeDefined()
      expect(sqliteRepo?.manifest_kind).toBe(legacyRepo.manifest_kind)
      expect(sqliteRepo?.plugin_name).toBe(legacyRepo.plugin_name)
      expect(sqliteRepo?.plugin_description).toBe(legacyRepo.plugin_description)
      expect(sqliteRepo).toEqual(legacyRepo)
    }
  })
})
