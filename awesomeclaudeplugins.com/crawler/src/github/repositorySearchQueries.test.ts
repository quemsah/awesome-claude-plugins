import { expect, it } from 'vitest'
import {
  buildRepositorySearchQuery,
  historicalWindows,
  repositorySearchQueries,
  repositorySearchQueryVersion,
  rollingPushedWindow,
  splitDateWindow,
} from './repositorySearchQueries.js'

it('emits the versioned generic public query catalog without a star floor', () => {
  expect(repositorySearchQueryVersion).toBe(2)
  expect(repositorySearchQueries).toEqual([
    { queryId: 'topic_claude_plugin', queryText: 'topic:claude-plugin is:public', lane: 'topic' },
    { queryId: 'topic_claude_code_marketplace', queryText: 'topic:claude-code-marketplace is:public', lane: 'topic' },
    { queryId: 'topic_claude_code_plugins', queryText: 'topic:claude-code-plugins is:public', lane: 'topic' },
    { queryId: 'topic_claude_code_plugin', queryText: 'topic:claude-code-plugin is:public', lane: 'topic' },
    { queryId: 'metadata_plugin', queryText: 'claude plugin in:name,description,topics is:public', lane: 'metadata' },
    { queryId: 'metadata_marketplace', queryText: 'claude marketplace in:name,description,topics is:public', lane: 'metadata' },
    { queryId: 'readme_plugin', queryText: 'claude plugin in:readme is:public', lane: 'readme' },
    { queryId: 'readme_marketplace', queryText: 'claude marketplace in:readme is:public', lane: 'readme' },
  ])
  expect(buildRepositorySearchQuery(repositorySearchQueries[4], { field: 'created', start: '2008-01-01', end: '2008-12-31' })).toBe(
    'claude plugin in:name,description,topics is:public created:2008-01-01..2008-12-31',
  )
})

it('uses inclusive last 30 UTC days and stable calendar-year history including the current year', () => {
  expect(rollingPushedWindow('2026-01-05T23:59:00-08:00')).toEqual({ field: 'pushed', start: '2025-12-08', end: '2026-01-06' })
  expect(historicalWindows('2010-03-04T20:00:00Z')).toEqual([
    { field: 'created', start: '2008-01-01', end: '2008-12-31' },
    { field: 'created', start: '2009-01-01', end: '2009-12-31' },
    { field: 'created', start: '2010-01-01', end: '2010-12-31' },
  ])
})

it('splits date windows at inclusive midpoints without overlaps, including leap day', () => {
  expect(splitDateWindow({ field: 'created', start: '2024-02-28', end: '2024-03-02' })).toEqual([
    { field: 'created', start: '2024-02-28', end: '2024-02-29' },
    { field: 'created', start: '2024-03-01', end: '2024-03-02' },
  ])
  expect(splitDateWindow({ field: 'pushed', start: '2026-10-30', end: '2026-10-30' })).toBeNull()
})
