import { describe, expect, it } from 'vitest'
import type { StatsItem } from '../../schemas/stats.schema.ts'
import { calculateTrend } from './StatsPage.tsx'

const DAY = 1000 * 60 * 60 * 24
const LATEST = Date.UTC(2026, 8, 19)

function snapshots(entries: Array<{ daysAgo: number; size: number }>): StatsItem[] {
  return entries.map((entry, index) => ({
    id: index + 1,
    date: new Date(LATEST - entry.daysAgo * DAY).toISOString(),
    size: entry.size,
  }))
}

const history = snapshots([
  { daysAgo: 20, size: 100 },
  { daysAgo: 10, size: 180 },
  { daysAgo: 3, size: 250 },
  { daysAgo: 0, size: 300 },
])

const lastWeek = history.slice(2)

describe('calculateTrend', () => {
  it('averages the increase over the range it is given', () => {
    expect(calculateTrend(history).averageDailyIncrease).toBe(10)
    expect(calculateTrend(lastWeek).averageDailyIncrease).toBe(16.67)
  })

  it('rounds midpoint averages symmetrically for growth and decline', () => {
    const growth = snapshots([
      { daysAgo: 200, size: 1000 },
      { daysAgo: 0, size: 1201 },
    ])
    const decline = snapshots([
      { daysAgo: 200, size: 1201 },
      { daysAgo: 0, size: 1000 },
    ])

    expect(calculateTrend(growth).averageDailyIncrease).toBe(1.01)
    expect(calculateTrend(decline).averageDailyIncrease).toBe(-1.01)
  })

  it('reports zero for a range too short to measure', () => {
    expect(calculateTrend(lastWeek.slice(1)).averageDailyIncrease).toBe(0)
    expect(calculateTrend([]).averageDailyIncrease).toBe(0)
  })
})
