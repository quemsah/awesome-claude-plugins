import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateTrend, fillMissingDates, filterStatsByTimeRange } from '../src/lib/stats.ts'

const snapshots = [
  { date: '2026-06-01T00:00:00.000Z', size: 100 },
  { date: '2026-06-04T00:00:00.000Z', size: 160 },
  { date: '2026-06-10T00:00:00.000Z', size: 200 },
]

test('filterStatsByTimeRange returns all snapshots for the all range', () => {
  assert.deepEqual(filterStatsByTimeRange(snapshots, 'all'), snapshots)
})

test('filterStatsByTimeRange filters relative to an injected current date', () => {
  const filtered = filterStatsByTimeRange(snapshots, '7days', new Date('2026-06-10T00:00:00.000Z'))

  assert.deepEqual(filtered, [snapshots[1], snapshots[2]])
})

test('calculateTrend returns growth, percentage, and period length', () => {
  assert.deepEqual(calculateTrend([snapshots[0], snapshots[2]]), {
    growth: 100,
    percentage: 100,
    periodDays: 1,
  })
})

test('fillMissingDates sorts snapshots and interpolates missing calendar days', () => {
  const filled = fillMissingDates([snapshots[1], snapshots[0]])

  assert.deepEqual(filled, [
    { date: '2026-06-01T00:00:00.000Z', size: 100 },
    { date: '2026-06-02T00:00:00.000Z', size: 120 },
    { date: '2026-06-03T00:00:00.000Z', size: 140 },
    { date: '2026-06-04T00:00:00.000Z', size: 160 },
  ])
})
