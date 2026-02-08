'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Area, AreaChart, Tooltip, XAxis, YAxis } from 'recharts'
import { formatDate } from '../../lib/utils.ts'
import type { StatsItem } from '../../schemas/stats.schema.ts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card.tsx'
import { ChartContainer, ChartTooltipContent } from '../ui/chart.tsx'
import { TimeFilter } from './TimeFilter.tsx'

const timeRangeLabels: Record<string, string> = {
  '7days': 'Last 7 days',
  '30days': 'Last 30 days',
  all: 'All time',
}

const MILLISECONDS_IN_DAY = 1000 * 60 * 60 * 24

interface StatsPageProps {
  stats: StatsItem[]
}

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

export function calculateTrend(filteredStats: StatsItem[]): { growth: number; percentage: number; periodDays: number } {
  if (filteredStats.length <= 1) {
    return { growth: 0, percentage: 0, periodDays: 0 }
  }

  const firstSize = Number.parseInt(filteredStats[0].size, 10) || 0
  const lastSize = Number.parseInt(filteredStats[filteredStats.length - 1].size, 10) || 0
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
        const currentSize = Number.parseInt(currentItem.size, 10) || 0
        const nextSize = Number.parseInt(nextItem.size, 10) || 0
        const dailyIncrement = (nextSize - currentSize) / dayDiff

        for (let day = 1; day < dayDiff; day++) {
          const missingDate = new Date(currentDate.getTime() + day * MILLISECONDS_IN_DAY)

          const interpolatedSize = Math.round(currentSize + dailyIncrement * day)

          filledStats.push({
            date: missingDate.toISOString(),
            size: interpolatedSize.toString(),
          })
        }
      }
    }
  }

  return filledStats
}

const removeTitleTag = (container: HTMLElement | null) => {
  if (!container) return
  const titleTags = container.querySelectorAll('.recharts-wrapper title')
  titleTags.forEach((tag) => {
    tag.remove()
  })
}

export function StatsPage({ stats }: StatsPageProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const [timeRange, setTimeRange] = useState('all')

  const filteredStats = useMemo(() => filterStatsByTimeRange(stats, timeRange), [stats, timeRange])

  const chartData = useMemo(() => {
    const filledData = fillMissingDates(filteredStats)
    return filledData.map((item) => ({
      date: item.date,
      size: Number.parseInt(item.size, 10) || 0,
      formattedDate: formatDate(new Date(item.date)),
    }))
  }, [filteredStats])

  const trendData = useMemo(() => calculateTrend(filteredStats), [filteredStats])

  const overallTrends = useMemo(() => {
    if (stats.length <= 1) {
      return { averageDailyIncrease: 0, totalDays: 0 }
    }
    const firstSize = Number.parseInt(stats[0].size, 10) || 0
    const lastSize = Number.parseInt(stats[stats.length - 1].size, 10) || 0
    const totalGrowth = lastSize - firstSize
    const totalDays = stats.length - 1
    return {
      averageDailyIncrease: Math.round((totalGrowth / totalDays) * 100) / 100,
      totalDays,
    }
  }, [stats])

  useEffect(() => {
    if (!chartRef.current) return

    const observer = new MutationObserver(() => {
      removeTitleTag(chartRef.current)
    })

    observer.observe(chartRef.current, {
      childList: true,
      subtree: true,
    })

    removeTitleTag(chartRef.current)

    return () => observer.disconnect()
  }, [])

  return (
    <div className="space-y-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <TimeFilter onTimeRangeChange={setTimeRange} value={timeRange} />
        {timeRange !== 'all' && trendData.periodDays > 0 && (
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">Trend:</span>
            <span className={`font-bold ${trendData.growth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {trendData.growth >= 0 ? '+' : ''}
              {trendData.growth} ({trendData.percentage}%)
            </span>
          </div>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="font-medium text-sm">
              <h3>Total Repositories</h3>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl">{chartData.length > 0 ? chartData[chartData.length - 1].size : 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="font-medium text-sm">
              <h3>Avg Daily Increase</h3>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl">
              {overallTrends.averageDailyIncrease >= 0 ? '+' : ''}
              {overallTrends.averageDailyIncrease}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Repository Count Over Time</CardTitle>
          <CardDescription>
            {timeRangeLabels[timeRange]} - Daily repository count from {chartData.length > 0 ? chartData[0].formattedDate : ''} to{' '}
            {chartData.length > 0 ? chartData[chartData.length - 1].formattedDate : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer
            aria-label="Repository growth chart showing daily repository count over time"
            className="h-100"
            config={{
              size: {
                label: 'Repository Count',
              },
            }}
            ref={chartRef}
          >
            <AreaChart aria-label="Repository growth over time" data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="fillSize" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <XAxis
                aria-label="Date"
                axisLine={false}
                dataKey="formattedDate"
                tickFormatter={(value) => value}
                tickLine={false}
                tickMargin={8}
              />
              <YAxis aria-label="Repository count" axisLine={false} tickFormatter={(value) => `${value}`} tickLine={false} tickMargin={8} />
              <Tooltip content={<ChartTooltipContent />} />
              <Area
                aria-label="Repository count trend"
                dataKey="size"
                fill="url(#fillSize)"
                fillOpacity={0.4}
                name="Repository Count"
                stackId="a"
                stroke="var(--chart-1)"
                type="monotone"
              />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  )
}
