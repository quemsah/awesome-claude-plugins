import type { StatsItem } from '../../schemas/stats.schema.ts'

export function filterStatsByTimeRange(stats: StatsItem[], timeRange: string): StatsItem[] {
  if (timeRange === 'all') {
    return stats
  }

  const now = new Date()
  const cutoffDate = new Date()

  if (timeRange === '7days') {
    cutoffDate.setDate(now.getDate() - 7)
  } else if (timeRange === '30days') {
    cutoffDate.setDate(now.getDate() - 30)
  }

  return stats.filter((item) => new Date(item.date) >= cutoffDate)
}

export interface StatsDisplay {
  /** True when the selected window has no snapshots but historical data exists. */
  isEmptyRange: boolean
  /** Snapshots to render: the filtered window, or the full history as a fallback. */
  displayStats: StatsItem[]
}

/**
 * Resolves which snapshots to render for a time range. A window with no
 * snapshots falls back to the full history so the counter never reads 0 while
 * data exists; `isEmptyRange` lets the caller surface an explanatory notice.
 * `stats` is expected to be sorted oldest-to-newest.
 */
export function resolveStatsDisplay(stats: StatsItem[], timeRange: string): StatsDisplay {
  const filteredStats = filterStatsByTimeRange(stats, timeRange)

  if (filteredStats.length === 0 && stats.length > 0) {
    return { isEmptyRange: true, displayStats: stats }
  }

  return { isEmptyRange: false, displayStats: filteredStats }
}
