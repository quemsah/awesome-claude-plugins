import Database from 'better-sqlite3'
import { afterEach, expect, it } from 'vitest'
import {
  historicalWindows,
  repositorySearchQueries,
  repositorySearchQueryVersion,
  rollingPushedWindow,
} from '../github/repositorySearchQueries.js'
import { inspect } from './inspect.js'
import { ensureRepositorySearchPartition, saveRepositorySearchPartition } from './repositorySearch.js'
import { setSetting } from './runs.js'
import { initializeSchema } from './schema.js'

const databases: Database.Database[] = []
const at = '2026-10-30T12:00:00Z'
function database() {
  const db = new Database(':memory:')
  initializeSchema(db)
  databases.push(db)
  return db
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})

it('reports never-run bounded sources without creating checkpoints', () => {
  const db = database()
  expect(inspect(db, new Date(at))).toMatchObject({
    coverageScope: 'configured_query_catalog',
    sources: {
      code_search: { lastCompleteScan: null, freshness: 'never_run', due: true },
      repo_search: {
        queryVersion: repositorySearchQueryVersion,
        freshness: 'never_run',
        lastCompleteScan: null,
        due: true,
        incompletePartitions: 160,
      },
    },
  })
  expect(db.prepare('SELECT COUNT(*) AS count FROM repository_search_partitions').get()).toEqual({ count: 0 })
})

it('reports incomplete pushed partitions from an older rolling window until resumed', () => {
  const db = database()
  const oldWindow = { field: 'pushed' as const, start: '2026-09-20', end: '2026-10-19' }
  const oldPartition = ensureRepositorySearchPartition(db, repositorySearchQueries[0].queryId, oldWindow)
  Object.assign(oldPartition, { status: 'incomplete', last_attempt_at: '2026-10-20T12:00:00Z', next_page: 2 })
  saveRepositorySearchPartition(db, oldPartition)

  expect(inspect(db, new Date(at)).sources.repo_search).toMatchObject({ freshness: 'incomplete' })
  expect(inspect(db, new Date(at)).sources.repo_search.partitions).toContainEqual(
    expect.objectContaining({
      queryId: repositorySearchQueries[0].queryId,
      partitionKey: oldPartition.partition_key,
      state: 'incomplete',
      nextPage: 2,
    }),
  )
})

it.each(['fresh', 'stale', 'incomplete'] as const)(
  'reports %s current-catalog coverage and ignores completed obsolete windows and versions',
  (state) => {
    const db = database()
    const completedAt = state === 'stale' ? '2026-07-01T00:00:00Z' : at
    for (const window of [rollingPushedWindow(at), ...historicalWindows(at)])
      for (const query of repositorySearchQueries) {
        const row = ensureRepositorySearchPartition(db, query.queryId, window)
        row.status = 'complete'
        row.last_completed_at = completedAt
        saveRepositorySearchPartition(db, row)
      }
    const row = ensureRepositorySearchPartition(db, 'metadata_plugin', rollingPushedWindow(at))
    if (state === 'incomplete') {
      row.status = 'incomplete'
      row.last_attempt_at = at
      row.incomplete_results = 1
      saveRepositorySearchPartition(db, row)
    }
    const obsoleteWindow = ensureRepositorySearchPartition(db, 'metadata_plugin', rollingPushedWindow('2026-10-01T00:00:00Z'))
    obsoleteWindow.status = 'complete'
    obsoleteWindow.last_completed_at = at
    saveRepositorySearchPartition(db, obsoleteWindow)
    db.prepare(
      'INSERT INTO repository_search_partitions (query_version, query_id, partition_key, date_field, date_start, date_end, status) VALUES (2, ?, ?, ?, ?, ?, ?)',
    ).run('old', 'old', 'pushed', '2000-01-01', '2000-01-01', 'incomplete')
    expect(inspect(db, new Date(at))).toMatchObject({
      sources: {
        repo_search: {
          freshness: state,
          due: state !== 'fresh',
          incompletePartitions: state === 'incomplete' ? 1 : 0,
          warnings: state === 'incomplete' ? expect.arrayContaining(['incomplete_partitions']) : expect.any(Array),
        },
      },
    })
    if (state === 'incomplete')
      expect(inspect(db, new Date(at)).sources.repo_search.partitions).toContainEqual(
        expect.objectContaining({ queryId: 'metadata_plugin', partitionKey: row.partition_key, incompleteResults: true }),
      )
  },
)

it('retains budget-skipped due coverage from the latest source snapshot even when checkpoints have old completions', () => {
  const db = database()
  for (const window of [rollingPushedWindow(at), ...historicalWindows(at)])
    for (const query of repositorySearchQueries) {
      const row = ensureRepositorySearchPartition(db, query.queryId, window)
      row.status = 'complete'
      row.last_completed_at = at
      saveRepositorySearchPartition(db, row)
    }
  setSetting(
    db,
    'discovery_source_repo_search',
    JSON.stringify({
      queryVersion: repositorySearchQueryVersion,
      lastAttempt: at,
      lastCompleteScan: '2026-10-29T12:00:00Z',
      state: 'incomplete',
      incompletePartitions: 4,
      warnings: ['request-budget'],
      rollingIncompleteStreak: 2,
    }),
  )
  expect(inspect(db, new Date(at))).toMatchObject({
    sources: {
      repo_search: {
        freshness: 'incomplete',
        due: true,
        incompletePartitions: 4,
        lastCompleteScan: '2026-10-29T12:00:00Z',
        warnings: expect.arrayContaining(['request-budget']),
        alerts: ['rolling_partition_repeatedly_incomplete'],
      },
    },
  })
})
