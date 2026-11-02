import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
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

  it('verifies pagination contract: rows alias, hasMore, and view=cards', () => {
    const reader = openPublicCatalog(tempDbPath)
    try {
      const page1 = reader.getBrowsePage({ pageSize: 3, page: 0, view: 'cards' })
      assert.equal(page1.matches.length, 3)
      assert.equal(page1.rows.length, 3)
      assert.equal(page1.hasMore, true)
      assert.equal(page1.total, testRepos.length)
      assert.equal(page1.matches[0].plugins, undefined)
      assert.ok(page1.matches[0].repo_name)

      const pageFull = reader.getBrowsePage({ pageSize: 3, page: 0, view: 'full' })
      assert.ok(pageFull.matches[0].plugins)

      const page3 = reader.getBrowsePage({ pageSize: 3, page: 2 })
      assert.equal(page3.matches.length, 1)
      assert.equal(page3.hasMore, false)
    } finally {
      reader.close()
    }
  })
})
