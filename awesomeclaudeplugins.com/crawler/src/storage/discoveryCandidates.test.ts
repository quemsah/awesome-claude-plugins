import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { discover } from '../crawl/discover.js'
import type { GitHubReader } from '../github/client.js'
import { discoveryYield, recordDiscoveryCandidate } from './discoveryCandidates.js'
import { rebindCanonicalUrl, upsertDiscovery } from './repositories.js'
import { beginRun } from './runs.js'
import { initializeSchema } from './schema.js'

it('deduplicates each source/query attribution while retaining both discovery sources and rejected candidates', () => {
  const db = new Database(':memory:')
  try {
    db.pragma('foreign_keys = ON')
    initializeSchema(db)
    beginRun(db, 'run', '2026-10-30T00:00:00Z')
    const id = upsertDiscovery(db, 'https://github.com/example/catalog', null)
    recordDiscoveryCandidate(db, 'run', id, 'code_search', 'marketplace_filename_path')
    recordDiscoveryCandidate(db, 'run', id, 'code_search', 'marketplace_filename_path')
    recordDiscoveryCandidate(db, 'run', id, 'code_search', 'marketplace_path_literal')
    recordDiscoveryCandidate(db, 'run', id, 'repo_search', 'readme_plugin')
    expect(
      db
        .prepare('SELECT source, COUNT(DISTINCT repository_id) AS candidates FROM discovery_candidates GROUP BY source ORDER BY source')
        .all(),
    ).toEqual([
      { source: 'code_search', candidates: 1 },
      { source: 'repo_search', candidates: 1 },
    ])
    expect(db.prepare('SELECT COUNT(*) AS count FROM discovery_candidates').get()).toEqual({ count: 3 })
    db.prepare('DELETE FROM repositories WHERE id = ?').run(id)
    expect(db.prepare('SELECT COUNT(*) AS count FROM discovery_candidates').get()).toEqual({ count: 3 })
  } finally {
    db.close()
  }
})

it('records each Code Search query even when both queries discover the same candidate', async () => {
  const db = new Database(':memory:')
  try {
    initializeSchema(db)
    beginRun(db, 'run', '2026-10-30T00:00:00Z')
    const reader: GitHubReader = {
      searchCode: async () => ({
        total_count: 1,
        incomplete_results: false,
        items: [
          { path: '.claude-plugin/marketplace.json', repository: { html_url: 'https://github.com/example/catalog', description: null } },
        ],
      }),
      searchRepositories: async () => {
        throw new Error('unexpected Repository Search')
      },
      getRepository: async () => {
        throw new Error('unexpected enrichment')
      },
      getMarketplace: async () => {
        throw new Error('unexpected marketplace fetch')
      },
    }
    expect((await discover(db, reader, 'run', [[0, 1]])).newUrls).toBe(1)
    expect(db.prepare('SELECT source, query_id FROM discovery_candidates ORDER BY query_id').all()).toEqual([
      { source: 'code_search', query_id: 'marketplace_filename_path' },
      { source: 'code_search', query_id: 'marketplace_path_literal' },
    ])
  } finally {
    db.close()
  }
})

it.each([true, false])(
  'merges attribution onto the surviving canonical repository atomically (source inserted first: %s)',
  (sourceFirst) => {
    const db = new Database(':memory:')
    try {
      db.pragma('foreign_keys = ON')
      initializeSchema(db)
      beginRun(db, 'run', '2026-10-30T00:00:00Z')
      const sourceUrl = 'https://github.com/example/old-name'
      const targetUrl = 'https://github.com/example/canonical'
      const first = upsertDiscovery(db, sourceFirst ? sourceUrl : targetUrl, null)
      const second = upsertDiscovery(db, sourceFirst ? targetUrl : sourceUrl, null)
      const sourceId = sourceFirst ? first : second
      const targetId = sourceFirst ? second : first
      const rejectedId = upsertDiscovery(db, 'https://github.com/example/rejected', null)
      recordDiscoveryCandidate(db, 'run', sourceId, 'code_search', 'marketplace_filename_path')
      recordDiscoveryCandidate(db, 'run', sourceId, 'repo_search', 'readme_plugin')
      recordDiscoveryCandidate(db, 'run', targetId, 'code_search', 'marketplace_path_literal')
      recordDiscoveryCandidate(db, 'run', targetId, 'repo_search', 'readme_plugin')
      recordDiscoveryCandidate(db, 'run', rejectedId, 'repo_search', 'readme_plugin')
      db.prepare('DELETE FROM repositories WHERE id = ?').run(rejectedId)
      const before = db.prepare('SELECT * FROM discovery_candidates ORDER BY repository_id, source, query_id').all()
      db.exec("CREATE TRIGGER block_merge BEFORE DELETE ON repositories BEGIN SELECT RAISE(ABORT, 'blocked merge'); END")
      expect(() => rebindCanonicalUrl(db, sourceId, targetUrl)).toThrow('blocked merge')
      expect(db.prepare('SELECT * FROM discovery_candidates ORDER BY repository_id, source, query_id').all()).toEqual(before)
      db.exec('DROP TRIGGER block_merge')

      expect(rebindCanonicalUrl(db, sourceId, targetUrl)).toEqual({ id: first, removedId: second })
      db.prepare('UPDATE repositories SET plugins_count = 2 WHERE id = ?').run(first)
      expect(
        db
          .prepare(`
      SELECT candidates.repository_id, candidates.source, candidates.query_id, repositories.plugins_count
      FROM discovery_candidates candidates LEFT JOIN repositories ON repositories.id = candidates.repository_id
      ORDER BY candidates.repository_id, candidates.source, candidates.query_id
    `)
          .all(),
      ).toEqual([
        { repository_id: first, source: 'code_search', query_id: 'marketplace_filename_path', plugins_count: 2 },
        { repository_id: first, source: 'code_search', query_id: 'marketplace_path_literal', plugins_count: 2 },
        { repository_id: first, source: 'repo_search', query_id: 'readme_plugin', plugins_count: 2 },
        { repository_id: rejectedId, source: 'repo_search', query_id: 'readme_plugin', plugins_count: null },
      ])
    } finally {
      db.close()
    }
  },
)

it('counts source-attributed accepted, rejected and pending candidates once across queries with a left join', () => {
  const db = new Database(':memory:')
  try {
    initializeSchema(db)
    beginRun(db, 'yield', '2026-10-30T00:00:00Z')
    for (const [name, count] of [
      ['accepted', 2],
      ['empty', 0],
      ['pending', null],
      ['removed', null],
    ] as const) {
      const id = upsertDiscovery(db, `https://github.com/example/${name}`, null)
      recordDiscoveryCandidate(db, 'yield', id, 'repo_search', 'metadata_plugin')
      recordDiscoveryCandidate(db, 'yield', id, 'repo_search', 'readme_plugin')
      if (name === 'accepted') recordDiscoveryCandidate(db, 'yield', id, 'code_search', 'marketplace_filename_path')
      if (name === 'removed') db.prepare('DELETE FROM repositories WHERE id = ?').run(id)
      else db.prepare('UPDATE repositories SET plugins_count = ? WHERE id = ?').run(count, id)
    }
    expect(discoveryYield(db, 'yield', 'repo_search')).toEqual({
      uniqueCandidates: 4,
      acceptedMarketplaces: 1,
      rejectedCandidates: 2,
      pendingCandidates: 1,
    })
    expect(discoveryYield(db, 'yield', 'code_search')).toEqual({
      uniqueCandidates: 1,
      acceptedMarketplaces: 1,
      rejectedCandidates: 0,
      pendingCandidates: 0,
    })
    expect(discoveryYield(db, 'yield')).toEqual({
      uniqueCandidates: 4,
      acceptedMarketplaces: 1,
      rejectedCandidates: 2,
      pendingCandidates: 1,
    })
  } finally {
    db.close()
  }
})
