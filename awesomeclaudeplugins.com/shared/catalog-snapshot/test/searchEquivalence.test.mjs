import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { buildPublicCatalog } from '../src/build.js'
import { openPublicCatalog } from '../src/read.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const tempDbPath = join(__dirname, 'test-search-equivalence.sqlite')

function isArchivedRepo(repo) {
  const prefix = /^\[archived\]/i
  return repo.archived === true || (repo.archived == null && prefix.test(repo.description?.trim() ?? ''))
}

function sortDateValue(value) {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function compareStars(left, right) {
  const descriptionSignal = (r) => (r.description?.trim() ? 1 : 0)
  return (
    (right.stargazers_count ?? 0) - (left.stargazers_count ?? 0) ||
    descriptionSignal(right) - descriptionSignal(left) ||
    left.source_order - right.source_order
  )
}

function compareForks(left, right) {
  return (
    (right.forks_count ?? 0) - (left.forks_count ?? 0) ||
    left.source_order - right.source_order
  )
}

function comparePlugins(left, right) {
  const pluginSignal = (r) =>
    (r.plugins_count ?? 0) * Math.log10((r.stargazers_count ?? 0) + 10)
  return (
    pluginSignal(right) - pluginSignal(left) ||
    (right.plugins_count ?? 0) - (left.plugins_count ?? 0) ||
    left.source_order - right.source_order
  )
}

function compareDates(left, right, field) {
  return (
    sortDateValue(right[field]) - sortDateValue(left[field]) ||
    (right.stargazers_count ?? 0) - (left.stargazers_count ?? 0) ||
    left.source_order - right.source_order
  )
}

function legacySort(repos, sortOption) {
  return [...repos].sort((left, right) => {
    const archivedDiff = Number(isArchivedRepo(left)) - Number(isArchivedRepo(right))
    if (archivedDiff !== 0) return archivedDiff
    switch (sortOption) {
      case 'forks-desc':
        return compareForks(left, right)
      case 'plugins-desc':
        return comparePlugins(left, right)
      case 'updated-desc':
        return compareDates(left, right, 'pushed_at')
      case 'created-desc':
        return compareDates(left, right, 'catalog_added_at')
      default:
        return compareStars(left, right)
    }
  })
}

describe('searchEquivalence', () => {
  after(() => {
    try {
      rmSync(tempDbPath, { force: true })
    } catch {}
  })

  const testRepos = [
    {
      id: 1,
      owner: 'alpha-org',
      repo_name: 'popular-repo',
      stargazers_count: 500,
      forks_count: 50,
      plugins_count: 3,
      description: 'Popular active repository with description',
      pushed_at: '2026-10-30T10:00:00.000Z',
      catalog_added_at: '2026-01-01T00:00:00.000Z',
      plugins: [{ name: 'tool-a', description: 'Alpha tool' }],
    },
    {
      id: 2,
      owner: 'beta-org',
      repo_name: 'zero-plugins-repo',
      stargazers_count: 300,
      forks_count: 20,
      plugins_count: 0,
      description: 'Repository with explicit 0 plugins',
      pushed_at: '2026-10-25T10:00:00.000Z',
      catalog_added_at: '2026-02-01T00:00:00.000Z',
    },
    {
      id: 3,
      owner: 'gamma-org',
      repo_name: 'null-plugins-repo',
      stargazers_count: 300,
      forks_count: 20,
      plugins_count: null,
      description: 'Repository with null plugins count',
      pushed_at: '2026-10-25T10:00:00.000Z',
      catalog_added_at: '2026-02-01T00:00:00.000Z',
    },
    {
      id: 4,
      owner: 'delta-org',
      repo_name: 'no-description-repo',
      stargazers_count: 500,
      forks_count: 10,
      plugins_count: 1,
      description: '',
      pushed_at: '2026-10-20T10:00:00.000Z',
      catalog_added_at: '2026-03-01T00:00:00.000Z',
    },
    {
      id: 5,
      owner: 'epsilon-org',
      repo_name: 'explicit-archived',
      stargazers_count: 1000,
      forks_count: 100,
      plugins_count: 10,
      archived: true,
      description: 'High star archived repo',
      pushed_at: '2026-10-31T10:00:00.000Z',
      catalog_added_at: '2026-04-01T00:00:00.000Z',
    },
    {
      id: 6,
      owner: 'zeta-org',
      repo_name: 'fallback-archived',
      stargazers_count: 800,
      forks_count: 80,
      plugins_count: 5,
      description: ' [Archived] Legacy project with description prefix ',
      pushed_at: '2026-10-29T10:00:00.000Z',
      catalog_added_at: '2026-05-01T00:00:00.000Z',
    },
    {
      id: 7,
      owner: 'eta-org',
      repo_name: 'explicit-unarchived-with-prefix',
      stargazers_count: 150,
      forks_count: 15,
      plugins_count: 2,
      archived: false,
      description: '[archived] in description but archived is false',
      pushed_at: '2026-10-28T10:00:00.000Z',
      catalog_added_at: '2026-06-01T00:00:00.000Z',
    },
  ].map((repo, idx) => ({ ...repo, source_order: idx }))

  it('matches legacy sort ordering across all 5 sort options', () => {
    buildPublicCatalog(
      {
        records: testRepos,
        stats: [],
        snapshotId: 'equivalence-sort-test',
      },
      tempDbPath
    )

    const reader = openPublicCatalog(tempDbPath)
    try {
      const sorts = ['stars-desc', 'forks-desc', 'plugins-desc', 'updated-desc', 'created-desc']

      for (const sort of sorts) {
        const expectedOrder = legacySort(testRepos, sort).map((r) => r.repo_name)
        const page = reader.getBrowsePage({ sort, pageSize: 50 })
        const actualOrder = page.matches.map((r) => r.repo_name)

        assert.deepEqual(
          actualOrder,
          expectedOrder,
          `Sort mismatch for ${sort}:\nActual: ${actualOrder.join(', ')}\nExpected: ${expectedOrder.join(', ')}`
        )
      }
    } finally {
      reader.close()
    }
  })

  it('verifies pagination contract: rows alias, hasMore, and view=cards strips all 4 fields', () => {
    const reader = openPublicCatalog(tempDbPath)
    try {
      // Test browse page view=cards
      const page1 = reader.getBrowsePage({ pageSize: 3, page: 0, view: 'cards' })
      assert.equal(page1.matches.length, 3)
      assert.equal(page1.rows.length, 3)
      assert.equal(page1.hasMore, true)
      assert.equal(page1.total, testRepos.length)
      for (const card of page1.matches) {
        assert.equal(card.plugins, undefined, 'plugins must be stripped in cards view')
        assert.equal(card.plugin_summaries, undefined, 'plugin_summaries must be stripped in cards view')
        assert.equal(card.plugin_name, undefined, 'plugin_name must be stripped in cards view')
        assert.equal(card.plugin_description, undefined, 'plugin_description must be stripped in cards view')
      }

      // Test searchRepos view=cards
      const searchCards = reader.searchRepos('popular', { view: 'cards' })
      assert.ok(searchCards.matches.length > 0)
      for (const match of searchCards.matches) {
        assert.equal(match.item.plugins, undefined, 'plugins must be stripped in search cards view')
        assert.equal(match.item.plugin_summaries, undefined, 'plugin_summaries must be stripped in search cards view')
        assert.equal(match.item.plugin_name, undefined, 'plugin_name must be stripped in search cards view')
        assert.equal(match.item.plugin_description, undefined, 'plugin_description must be stripped in search cards view')
      }

      const pageFull = reader.getBrowsePage({ pageSize: 3, page: 0, view: 'full' })
      assert.ok(pageFull.matches[0].plugins)

      const page3 = reader.getBrowsePage({ pageSize: 3, page: 2 })
      assert.equal(page3.matches.length, 1)
      assert.equal(page3.hasMore, false)
    } finally {
      reader.close()
    }
  })

  // Reference legacy FTS5 search index builder from ui/src/lib/fuzzySearch.ts
  function createReferenceLegacySearchIndex(repos) {
    const db = new Database(':memory:')
    db.exec(`
      CREATE VIRTUAL TABLE search USING fts5(text, content='', tokenize='unicode61 tokenchars ''+#''', prefix='1 2 3 4');
      CREATE TABLE metadata (
        id INTEGER PRIMARY KEY, archived INTEGER, stars INTEGER, description INTEGER,
        forks INTEGER, plugins INTEGER, plugin_signal REAL, updated REAL, created REAL
      );
    `)
    const insertText = db.prepare('INSERT INTO search(rowid, text) VALUES (?, ?)')
    const insertMetadata = db.prepare('INSERT INTO metadata VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')

    for (const [id, repo] of repos.entries()) {
      const text = [
        repo.repo_name,
        repo.owner,
        repo.description,
        repo.plugin_name,
        repo.plugin_description,
        ...(repo.plugins ?? []).flatMap((p) => [p.name, p.description]),
        ...(repo.plugin_summaries ?? []).flatMap((p) => [p.name, p.description]),
      ].filter((v) => typeof v === 'string' && v.trim().length > 0).join(' ')
      insertText.run(id, text)
      const stars = repo.stargazers_count ?? 0
      const plugins = repo.plugins_count ?? 0
      insertMetadata.run(
        id,
        Number(isArchivedRepo(repo)),
        stars,
        repo.description?.trim() ? 1 : 0,
        repo.forks_count ?? 0,
        plugins,
        plugins * Math.log10(stars + 10),
        sortDateValue(repo.pushed_at),
        sortDateValue(repo.catalog_added_at)
      )
    }
    db.exec("INSERT INTO search(search) VALUES ('optimize')")

    const sortSql = {
      'stars-desc': 'stars DESC, description DESC',
      'forks-desc': 'forks DESC',
      'plugins-desc': 'plugin_signal DESC, plugins DESC',
      'updated-desc': 'updated DESC, stars DESC',
      'created-desc': 'created DESC, stars DESC',
    }

    const sorts = Object.entries(sortSql).map(([sort, order], i) => ({ sort, order, column: `sort${i}` }))
    db.exec(`
      CREATE TABLE ranks (id INTEGER PRIMARY KEY, plugins INTEGER, ${sorts.map(({ column }) => `${column} INTEGER`).join(', ')});
      INSERT INTO ranks SELECT id, plugins,
        ${sorts.map(({ order }) => `dense_rank() OVER (ORDER BY archived, ${order})`).join(', ')} FROM metadata;
      DROP TABLE metadata;
      ALTER TABLE ranks RENAME TO metadata;
    `)

    const totals = db.prepare(`
      SELECT count(*) AS total, coalesce(sum(plugins), 0) AS pluginsCount
      FROM search JOIN metadata ON metadata.id = search.rowid WHERE search MATCH ?
    `)

    const pages = new Map()
    for (const { sort, column } of sorts) {
      pages.set(
        sort,
        db.prepare(`
          WITH cutoff AS MATERIALIZED (
            SELECT ${column} AS value FROM search JOIN metadata ON metadata.id = search.rowid WHERE search MATCH ?
            ORDER BY ${column} LIMIT 1 OFFSET ?
          )
          SELECT search.rowid AS id, bm25(search) AS score
          FROM search JOIN metadata ON metadata.id = search.rowid WHERE search MATCH ?
            AND ${column} <= (SELECT value FROM cutoff)
          ORDER BY ${column}, score, metadata.id LIMIT ? OFFSET ?
        `)
      )
    }

    const queryTerms = /[+#]*[\p{L}\p{N}\p{M}]+(?:[+#]+[\p{L}\p{N}\p{M}]+|[+#]+)*/gu
    function getSearchTerms(query) {
      const terms = query.match(queryTerms) ?? []
      return terms.length === 0 || (terms.length === 1 && [...terms[0]].length < 2) ? [] : terms
    }

    return {
      search(query, sort = 'stars-desc', page = 0, pageSize = 24) {
        const terms = getSearchTerms(query)
        if (terms.length === 0) {
          return { matches: [], total: 0, pluginsCount: 0 }
        }
        const expression = terms.map((term, i) => `"${term}"${i === terms.length - 1 ? '*' : ''}`).join(' AND ')
        const counts = totals.get(expression) ?? { total: 0, pluginsCount: 0 }
        const offset = page * pageSize
        const rows =
          counts.total > offset
            ? pages.get(sort).all(expression, Math.min(offset + pageSize, counts.total) - 1, expression, pageSize, offset)
            : []
        return {
          ...counts,
          matches: rows.map((row) => ({ item: repos[row.id], score: row.score })),
        }
      },
      close() {
        db.close()
      },
    }
  }

  /**
   * Search Equivalence Gate:
   * Compares searchRepos() against the legacy createCatalogSearchIndex() algorithm.
   *
   * Note on plugins >30 indexing:
   * In the legacy UI split-catalog, only the first 30 plugin names were indexed due to bundle limits.
   * The new SQLite catalog-snapshot builder indexes ALL plugins without truncation into repo_fts,
   * providing full search coverage across large marketplaces.
   */
  it('exhibits differential search equivalence across popular, rare, and boundary queries in all 5 sort options', async () => {
    const { createRequire } = await import('node:module')
    const Database = createRequire(import.meta.url)('better-sqlite3')

    const searchTestRepos = [
      {
        id: 101,
        owner: 'acme-corp',
        repo_name: 'claude-toolkit',
        stargazers_count: 800,
        forks_count: 80,
        plugins_count: 4,
        description: 'Comprehensive Claude toolkit and devtools suite',
        pushed_at: '2026-10-31T10:00:00.000Z',
        catalog_added_at: '2026-01-01T00:00:00.000Z',
        plugins: [{ name: 'toolkit-runner', description: 'Runs tools' }],
      },
      {
        id: 102,
        owner: 'acme-corp',
        repo_name: 'claude-plugins-bundle',
        stargazers_count: 500,
        forks_count: 50,
        plugins_count: 10,
        description: 'Bundle of plugins for Claude Code development',
        pushed_at: '2026-10-25T10:00:00.000Z',
        catalog_added_at: '2026-02-01T00:00:00.000Z',
        plugins: [{ name: 'bundle-core', description: 'Core bundle logic' }],
      },
      {
        id: 103,
        owner: 'dev-lab',
        repo_name: 'rare-cplusplus-tool',
        stargazers_count: 200,
        forks_count: 20,
        plugins_count: 1,
        description: 'Specialized C++ parser and compiler plugin',
        pushed_at: '2026-10-20T10:00:00.000Z',
        catalog_added_at: '2026-03-01T00:00:00.000Z',
        plugins: [{ name: 'cpp-tool', description: 'C++ integration' }],
      },
      {
        id: 104,
        owner: 'dev-lab',
        repo_name: 'devtools-logger',
        stargazers_count: 500,
        forks_count: 30,
        plugins_count: 2,
        description: 'Lightweight logging tool for Claude devtools',
        pushed_at: '2026-10-28T10:00:00.000Z',
        catalog_added_at: '2026-04-01T00:00:00.000Z',
        plugins: [{ name: 'logger', description: 'Log helper' }],
      },
      {
        id: 105,
        owner: 'legacy-archive',
        repo_name: 'archived-claude-tool',
        stargazers_count: 1500,
        forks_count: 150,
        plugins_count: 5,
        archived: true,
        description: 'Legacy Claude devtools archived long ago',
        pushed_at: '2026-10-29T10:00:00.000Z',
        catalog_added_at: '2026-05-01T00:00:00.000Z',
      },
    ].map((r, i) => ({ ...r, source_order: i }))

    const searchDbPath = join(__dirname, 'test-search-differential.sqlite')
    try {
      buildPublicCatalog(
        {
          records: searchTestRepos,
          stats: [],
          snapshotId: 'differential-search-test',
        },
        searchDbPath
      )

      const reader = openPublicCatalog(searchDbPath)
      const legacySearch = createReferenceLegacySearchIndex(searchTestRepos)

      try {
        const testQueries = [
          'claude',
          'toolkit',
          'devtools',
          'bundle',
          'rare',
          'c++',
          'claude devtools',
        ]
        const sorts = ['stars-desc', 'forks-desc', 'plugins-desc', 'updated-desc', 'created-desc']

        for (const query of testQueries) {
          for (const sort of sorts) {
            // First page
            const expectedPage0 = legacySearch.search(query, sort, 0, 2)
            const actualPage0 = reader.searchRepos(query, { sort, page: 0, pageSize: 2 })

            assert.equal(actualPage0.total, expectedPage0.total, `Total mismatch for "${query}" (${sort})`)
            assert.equal(actualPage0.pluginsCount, expectedPage0.pluginsCount, `pluginsCount mismatch for "${query}" (${sort})`)
            assert.deepEqual(
              actualPage0.matches.map((m) => m.item.repo_name),
              expectedPage0.matches.map((m) => m.item.repo_name),
              `Page 0 matches mismatch for "${query}" (${sort})`
            )

            // Second page
            const expectedPage1 = legacySearch.search(query, sort, 1, 2)
            const actualPage1 = reader.searchRepos(query, { sort, page: 1, pageSize: 2 })

            assert.equal(actualPage1.total, expectedPage1.total)
            assert.deepEqual(
              actualPage1.matches.map((m) => m.item.repo_name),
              expectedPage1.matches.map((m) => m.item.repo_name),
              `Page 1 matches mismatch for "${query}" (${sort})`
            )
          }
        }
      } finally {
        legacySearch.close()
        reader.close()
      }
    } finally {
      try {
        rmSync(searchDbPath, { force: true })
      } catch {}
    }
  })

  it('preserves search ranking and BM25 scores in the presence of case-variant duplicates', async () => {
    const { createRequire } = await import('node:module')
    const Database = createRequire(import.meta.url)('better-sqlite3')

    // Two canonical repos with identical metrics
    const canonicalRepos = [
      {
        id: 201,
        owner: 'org-a',
        repo_name: 'target-repo-first',
        stargazers_count: 100,
        forks_count: 10,
        plugins_count: 2,
        description: 'Search target repo first instance keyword apple banana',
        pushed_at: '2026-10-30T10:00:00.000Z',
        catalog_added_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 202,
        owner: 'org-b',
        repo_name: 'target-repo-second',
        stargazers_count: 100,
        forks_count: 10,
        plugins_count: 2,
        description: 'Search target repo second instance keyword apple banana cherry',
        pushed_at: '2026-10-30T10:00:00.000Z',
        catalog_added_at: '2026-01-01T00:00:00.000Z',
      },
    ]

    // Ten case-variant duplicates of the first repo with distorted term frequencies
    const duplicateVariants = Array.from({ length: 10 }, (_, i) => ({
      id: 300 + i,
      owner: `ORG-A`,
      repo_name: `TARGET-REPO-FIRST`,
      stargazers_count: 100,
      forks_count: 10,
      plugins_count: 2,
      description: 'Massive spam term banana banana banana banana apple',
      pushed_at: '2026-10-30T10:00:00.000Z',
      catalog_added_at: '2026-01-01T00:00:00.000Z',
    }))

    const reposWithoutDuplicates = [...canonicalRepos]
    const reposWithDuplicates = [...canonicalRepos, ...duplicateVariants]

    const pathClean = join(__dirname, 'test-clean-fts.sqlite')
    const pathDuplicates = join(__dirname, 'test-duplicates-fts.sqlite')

    try {
      buildPublicCatalog(
        { records: reposWithoutDuplicates, stats: [], snapshotId: 'clean-fts' },
        pathClean
      )
      buildPublicCatalog(
        { records: reposWithDuplicates, stats: [], snapshotId: 'dup-fts' },
        pathDuplicates
      )

      const readerClean = openPublicCatalog(pathClean)
      const readerDuplicates = openPublicCatalog(pathDuplicates)

      try {
        const cleanResults = readerClean.searchRepos('apple banana')
        const dupResults = readerDuplicates.searchRepos('apple banana')

        // Must match exact same total canonical results and ordering
        assert.equal(cleanResults.total, 2)
        assert.equal(dupResults.total, 2)
        assert.deepEqual(
          dupResults.matches.map((m) => m.item.repo_name),
          cleanResults.matches.map((m) => m.item.repo_name)
        )

        // BM25 scores must be identical because non-canonical records were not indexed into repo_fts
        assert.equal(dupResults.matches[0].score, cleanResults.matches[0].score)
        assert.equal(dupResults.matches[1].score, cleanResults.matches[1].score)
      } finally {
        readerClean.close()
        readerDuplicates.close()
      }
    } finally {
      try {
        rmSync(pathClean, { force: true })
        rmSync(pathDuplicates, { force: true })
      } catch {}
    }
  })
})
