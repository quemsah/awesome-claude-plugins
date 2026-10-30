import { expect, it } from 'vitest'
import { createStatsDraft } from './statsDraft.js'

it('takes the next unused ID even when history has gaps and does not change history', () => {
  const history = Object.freeze([
    Object.freeze({ id: 1, date: '2025-10-28T08:47:47.493Z', size: 415 }),
    Object.freeze({ id: 303, date: '2026-09-22T08:12:33.125Z', size: 40958 }),
  ])
  const now = new Date('2026-09-23T21:00:00.000Z')
  expect(createStatsDraft(history, 40959, now)).toEqual({
    id: 304,
    date: '2026-09-23T21:00:00.000Z',
    size: 40959,
  })
  expect(history).toHaveLength(2)
  expect(history[1]?.size).toBe(40958)
})

it('starts at one when no historical stats exist and supports an empty public catalog', () => {
  expect(createStatsDraft([], 0, new Date('2027-01-01T00:00:00.000Z'))).toEqual({
    id: 1,
    date: '2027-01-01T00:00:00.000Z',
    size: 0,
  })
})
