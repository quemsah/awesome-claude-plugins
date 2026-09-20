import { describe, expect, it } from 'vitest'
import type { StatsItem } from '../../schemas/stats.schema.ts'
import { filterStatsByTimeRange, resolveStatsDisplay } from './statsView.ts'

const DAY = 1000 * 60 * 60 * 24

function snapshots(entries: Array<{ daysAgo: number; size: number }>): StatsItem[] {
  return entries.map((entry, index) => ({
    id: index + 1,
    date: new Date(Date.now() - entry.daysAgo * DAY).toISOString(),
    size: entry.size,
  }))
}

describe('resolveStatsDisplay', () => {
  it('flags an empty window and falls back to full history instead of showing zero', () => {
    const stats = snapshots([
      { daysAgo: 41, size: 38000 },
      { daysAgo: 40, size: 38120 },
    ])

    const view = resolveStatsDisplay(stats, '7days')

    expect(view.isEmptyRange).toBe(true)
    // The counter must never collapse to 0 while historical data exists.
    expect(view.displayStats).toHaveLength(2)
    expect(view.displayStats[view.displayStats.length - 1].size).toBe(38120)
  })

  it('keeps a window that contains at least one snapshot', () => {
    const stats = snapshots([
      { daysAgo: 120, size: 100 },
      { daysAgo: 2, size: 40210 },
    ])

    const view = resolveStatsDisplay(stats, '7days')

    expect(view.isEmptyRange).toBe(false)
    expect(view.displayStats).toHaveLength(1)
    expect(view.displayStats[0].size).toBe(40210)
  })

  it('returns the full series untouched for the all-time range', () => {
    const stats = snapshots([{ daysAgo: 300, size: 1 }])

    const view = resolveStatsDisplay(stats, 'all')

    expect(view.isEmptyRange).toBe(false)
    expect(view.displayStats).toBe(stats)
  })

  it('does not treat a completely empty catalogue as a fallback range', () => {
    const view = resolveStatsDisplay([], '7days')

    expect(view.isEmptyRange).toBe(false)
    expect(view.displayStats).toEqual([])
  })
})

describe('filterStatsByTimeRange', () => {
  it('drops snapshots older than the 30-day cutoff', () => {
    const stats = snapshots([
      { daysAgo: 60, size: 1 },
      { daysAgo: 5, size: 2 },
    ])

    expect(filterStatsByTimeRange(stats, '30days')).toHaveLength(1)
  })
})
