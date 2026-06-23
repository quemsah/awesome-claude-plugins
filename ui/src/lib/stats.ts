import type { StatsItem } from '../schemas/stats.schema.ts'

const MILLISECONDS_IN_DAY = 1000 * 60 * 60 * 24

export function filterStatsByTimeRange(stats: StatsItem[], timeRange: string, now = new Date()): StatsItem[] {
  if (timeRange === 'all') {
    return stats
  }

  const cutoffDate = new Date(now)

  if (timeRange === '7days') {
    cutoffDate.setDate(now.getDate() - 7)
  } else if (timeRange === '30days') {
    cutoffDate.setDate(now.getDate() - 30)
  }

  return stats.filter((item) => new Date(item.date) >= cutoffDate)
}

export function calculateTrend(filteredStats: StatsItem[]): { growth: number; percentage: number; periodDays: number } {
  if (filteredStats.length <= 1) {
    return { growth: 0, percentage: 0, periodDays: 0 }
  }

  const firstSize = filteredStats[0].size
  const lastSize = filteredStats[filteredStats.length - 1].size
  const totalGrowth = lastSize - firstSize
  const periodDays = Math.max(1, filteredStats.length - 1)

  const percentage = firstSize > 0 ? Math.round((totalGrowth / firstSize) * 10000) / 100 : 0

  return {
    growth: totalGrowth,
    percentage,
    periodDays,
  }
}

export function fillMissingDates(stats: StatsItem[]): StatsItem[] {
  if (stats.length <= 1) {
    return [...stats]
  }

  const statsWithDateObjects = stats.map((s) => ({ ...s, dateObj: new Date(s.date) }))
  const sortedStats = statsWithDateObjects.sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime())

  const filledStats: StatsItem[] = []

  for (let i = 0; i < sortedStats.length; i++) {
    const currentItem = sortedStats[i]
    filledStats.push({ date: currentItem.date, size: currentItem.size })

    if (i < sortedStats.length - 1) {
      const nextItem = sortedStats[i + 1]
      const currentDate = currentItem.dateObj
      const nextDate = nextItem.dateObj

      const timeDiff = nextDate.getTime() - currentDate.getTime()
      const dayDiff = Math.floor(timeDiff / MILLISECONDS_IN_DAY)

      if (dayDiff > 1) {
        const currentSize = currentItem.size
        const nextSize = nextItem.size
        const dailyIncrement = (nextSize - currentSize) / dayDiff

        for (let day = 1; day < dayDiff; day++) {
          const missingDate = new Date(currentDate.getTime() + day * MILLISECONDS_IN_DAY)

          const interpolatedSize = Math.round(currentSize + dailyIncrement * day)

          filledStats.push({
            date: missingDate.toISOString(),
            size: interpolatedSize,
          })
        }
      }
    }
  }

  return filledStats
}
