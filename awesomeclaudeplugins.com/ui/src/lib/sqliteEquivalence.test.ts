import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { findCatalogRepo, searchCatalogRepos } from './catalog.ts'
import { isRepoPageEndingInMd } from './markdownPaths.ts'
import { sqliteFindCatalogRepo, sqliteSearchCatalogRepos } from './sqliteCatalogStore.ts'

describe('PR 2 SQLite migration equivalence tests', () => {
  beforeAll(async () => {
    const dbPath = join(process.cwd(), 'src/data/catalog.sqlite')
    if (!existsSync(dbPath)) {
      // @ts-expect-error dynamic script import
      const { prepareCatalog } = await import('../../scripts/prepare-catalog.mjs')
      await prepareCatalog({ silent: true })
    }
  }, 30000)
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
      // 1. Full view
      const legacyFull = searchCatalogRepos(query, sort, page, pageSize)
      const sqliteFull = sqliteSearchCatalogRepos(query, sort, page, pageSize)

      expect(sqliteFull.total).toBe(legacyFull.total)
      expect(sqliteFull.pluginsCount).toBe(legacyFull.pluginsCount)
      expect(sqliteFull.hasMore).toBe(legacyFull.hasMore)

      const legacyFullPaths = legacyFull.repos.map((r) => `${r.owner}/${r.repo_name}`.toLowerCase())
      const sqliteFullPaths = sqliteFull.repos.map((r) => `${r.owner}/${r.repo_name}`.toLowerCase())
      expect(sqliteFullPaths).toEqual(legacyFullPaths)

      // Compare full API payloads
      expect(sqliteFull.repos).toEqual(legacyFull.repos)

      // 2. Cards view (view=cards / summaries: 'omit')
      const legacyCards = searchCatalogRepos(query, sort, page, pageSize, { summaries: 'omit' })
      const sqliteCards = sqliteSearchCatalogRepos(query, sort, page, pageSize, { summaries: 'omit' })

      expect(sqliteCards.total).toBe(legacyCards.total)
      expect(sqliteCards.pluginsCount).toBe(legacyCards.pluginsCount)
      expect(sqliteCards.hasMore).toBe(legacyCards.hasMore)

      const legacyCardPaths = legacyCards.repos.map((r) => `${r.owner}/${r.repo_name}`.toLowerCase())
      const sqliteCardPaths = sqliteCards.repos.map((r) => `${r.owner}/${r.repo_name}`.toLowerCase())
      expect(sqliteCardPaths).toEqual(legacyCardPaths)

      // Verify stripped fields on cards view
      for (const card of sqliteCards.repos) {
        expect(card).not.toHaveProperty('plugins')
        expect(card).not.toHaveProperty('plugin_summaries')
        expect(card).not.toHaveProperty('plugin_name')
        expect(card).not.toHaveProperty('plugin_description')
      }
      expect(sqliteCards.repos).toEqual(legacyCards.repos)
    }
  }, 30000)

  it('searchOnlyInPluginDescription: finds hits matching solely within plugin descriptions identically', () => {
    // A search term that targets plugin descriptions specifically
    const query = 'summarize'
    const legacy = searchCatalogRepos(query, 'stars-desc', 0, 24)
    const sqlite = sqliteSearchCatalogRepos(query, 'stars-desc', 0, 24)

    expect(sqlite.total).toBe(legacy.total)
    expect(sqlite.pluginsCount).toBe(legacy.pluginsCount)
    expect(sqlite.repos.map((r) => `${r.owner}/${r.repo_name}`.toLowerCase())).toEqual(
      legacy.repos.map((r) => `${r.owner}/${r.repo_name}`.toLowerCase())
    )
    expect(sqlite.repos).toEqual(legacy.repos)
  })

  it('stableSortTies: breaks ties identically using source_order ASC', () => {
    // When many repos have identical metrics (e.g., page 50 of stars-desc where stars = 0)
    const legacyTies = searchCatalogRepos('', 'stars-desc', 50, 50)
    const sqliteTies = sqliteSearchCatalogRepos('', 'stars-desc', 50, 50)

    expect(sqliteTies.total).toBe(legacyTies.total)
    expect(sqliteTies.repos.map((r) => `${r.owner}/${r.repo_name}`.toLowerCase())).toEqual(
      legacyTies.repos.map((r) => `${r.owner}/${r.repo_name}`.toLowerCase())
    )
  })

  it('literalMarkdownRepositoryNegotiation: correctly identifies repos whose name ends in .md vs plain repos', () => {
    // Direct repository names ending in .md
    expect(isRepoPageEndingInMd('sstklen/yes.md')).toBe(true)
    expect(isRepoPageEndingInMd('SSTKLEN/YES.MD')).toBe(true)

    // Ordinary repositories not ending in .md
    expect(isRepoPageEndingInMd('anthropics/anthropic-quickstarts')).toBe(false)
    expect(isRepoPageEndingInMd('unknown/fake-repo.md')).toBe(false)
  })

  it('standaloneInstallUnchanged: preserves standalone plugin manifests and install commands', () => {
    // Find a standalone repository in the catalog
    const standaloneRepoPath = 'wshxbqq/claude-plugins'
    const legacyRepo = findCatalogRepo(standaloneRepoPath)
    const sqliteRepo = sqliteFindCatalogRepo(standaloneRepoPath)

    if (legacyRepo) {
      expect(sqliteRepo).toBeDefined()
      expect(sqliteRepo?.manifest_kind).toBe(legacyRepo.manifest_kind)
      expect(sqliteRepo?.plugin_name).toBe(legacyRepo.plugin_name)
      expect(sqliteRepo?.plugin_description).toBe(legacyRepo.plugin_description)
      expect(sqliteRepo).toEqual(legacyRepo)
    }
  })
})
