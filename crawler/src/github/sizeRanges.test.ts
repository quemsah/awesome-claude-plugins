import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { discover } from '../crawl/discover.js'
import { beginRun } from '../storage/runs.js'
import { initializeSchema } from '../storage/schema.js'
import { SIZE_RANGES } from './sizeRanges.js'

const workflowPath = resolve(import.meta.dirname, '../../../n8n/_c2 Fetch Code API.json')

function workflowQueries(): Array<{ range: [number, number]; query: string }> {
  const workflow = JSON.parse(readFileSync(workflowPath, 'utf8')) as {
    nodes: Array<{ name: string; parameters: { assignments: { assignments: Array<{ value: string }> } } }>
  }
  const editFields = workflow.nodes.filter((node) => node.name === 'Edit Fields1')
  expect(editFields).toHaveLength(1)

  const source = editFields[0].parameters.assignments.assignments[0].value
  return Array.from(
    source.matchAll(/\?q=(filename:marketplace\.json\+path:\.claude-plugin\+size:(\d+)\.\.(\d+))/g),
    ([, encodedQuery, min, max]) => ({
      range: [Number(min), Number(max)],
      query: new URLSearchParams(`q=${encodedQuery}`).get('q') as string,
    }),
  )
}

describe('GitHub Code Search size ranges', () => {
  it('preserves the permanent ordered 220-range fingerprint without needing the workflow', () => {
    expect(SIZE_RANGES).toHaveLength(220)
    expect(SIZE_RANGES[0]).toEqual([0, 150])
    expect(SIZE_RANGES.at(-1)).toEqual([270001, 400000])
    expect(createHash('sha256').update(JSON.stringify(SIZE_RANGES)).digest('hex')).toBe(
      'e37032a92e70bfa56d47f82b7075a77f04a588a87f5d56326f52bac0bfbd6510',
    )
    expect(Object.isFrozen(SIZE_RANGES)).toBe(true)
    expect(SIZE_RANGES.every((range) => Object.isFrozen(range))).toBe(true)
  })

  it('covers every integer file size from 0 through 400000 with the intended endpoint overlaps', () => {
    expect(SIZE_RANGES[0][0]).toBe(0)
    expect(SIZE_RANGES.at(-1)?.[1]).toBe(400000)
    expect(SIZE_RANGES.every(([min, max]) => Number.isInteger(min) && min <= max && Number.isInteger(max))).toBe(true)
    expect(SIZE_RANGES.every((range, index) => index === 0 || range[0] > SIZE_RANGES[index - 1][0])).toBe(true)
    expect(SIZE_RANGES.every((range, index) => index === 0 || range[0] <= SIZE_RANGES[index - 1][1] + 1)).toBe(true)
    expect(SIZE_RANGES.filter((range, index) => index > 0 && range[0] <= SIZE_RANGES[index - 1][1])).toHaveLength(71)
    expect(SIZE_RANGES[1]).toEqual([150, 200])
    expect(SIZE_RANGES[2]).toEqual([200, 216])
  })

  it.skipIf(!existsSync(workflowPath))('matches every ordered range from Edit Fields1 when the workflow is available', () => {
    const sourceRanges = workflowQueries().map(({ range }) => range)
    expect(sourceRanges).toHaveLength(220)
    expect(SIZE_RANGES).toEqual(sourceRanges)
  })

  it.skipIf(!existsSync(workflowPath))('sends every original n8n query through the production discovery path', async () => {
    const db = new Database(':memory:')
    initializeSchema(db)
    beginRun(db, 'all-ranges', '2026-09-23T00:00:00Z')
    const queries: string[] = []
    try {
      await discover(
        db,
        {
          searchCode: async (query) => {
            queries.push(query)
            return { items: [], total_count: 0, incomplete_results: false }
          },
          getRepository: async () => {
            throw new Error('Discovery must not enrich repositories')
          },
          getMarketplace: async () => {
            throw new Error('Discovery must not fetch marketplaces')
          },
        },
        'all-ranges',
      )
      expect(queries).toEqual(workflowQueries().map(({ query }) => query))
    } finally {
      db.close()
    }
  })
})
