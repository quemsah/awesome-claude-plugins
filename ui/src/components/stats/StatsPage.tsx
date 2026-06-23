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
const numberFormatter = new Intl.NumberFormat('en-US')
const percentageFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
})

interface StatsPageProps {
  stats: StatsItem[]
}

type ChartDataPoint = {
  date: string
  size: number
  formattedDate: string
}

type StatsSummary = {
  currentTotal: number
  endDate: string
  netGrowth: number
  percentageGrowth: number
  pointCount: number
  rangeLabel: string
  startDate: string
  summaryText: string
  trendDescription: string
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

function formatSignedNumber(value: number): string {
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${numberFormatter.format(value)}`
}

function formatSignedPercentage(value: number): string {
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${percentageFormatter.format(value)}%`
}

function getTrendDescription(netGrowth: number): string {
  if (netGrowth > 0) {
    return 'increased'
  }

  if (netGrowth < 0) {
    return 'decreased'
  }

  return 'did not change'
}

export function buildStatsSummary(chartData: ChartDataPoint[], timeRange: string): StatsSummary {
  const rangeLabel = timeRangeLabels[timeRange] ?? 'Selected range'

  if (chartData.length === 0) {
    return {
      currentTotal: 0,
      endDate: 'No data',
      netGrowth: 0,
      percentageGrowth: 0,
      pointCount: 0,
      rangeLabel,
      startDate: 'No data',
      summaryText: `${rangeLabel}: no repository data is available for this range.`,
      trendDescription: 'has no data',
    }
  }

  const firstPoint = chartData[0]
  const lastPoint = chartData[chartData.length - 1]
  const netGrowth = lastPoint.size - firstPoint.size
  const percentageGrowth = firstPoint.size > 0 ? Math.round((netGrowth / firstPoint.size) * 10000) / 100 : 0
  const trendDescription = getTrendDescription(netGrowth)

  return {
    currentTotal: lastPoint.size,
    endDate: lastPoint.formattedDate,
    netGrowth,
    percentageGrowth,
    pointCount: chartData.length,
    rangeLabel,
    startDate: firstPoint.formattedDate,
    summaryText: `${rangeLabel}: current total ${numberFormatter.format(lastPoint.size)} repositories on ${
      lastPoint.formattedDate
    }; range ${firstPoint.formattedDate} to ${lastPoint.formattedDate}; net growth ${formatSignedNumber(
      netGrowth
    )} repositories; percentage growth ${formatSignedPercentage(percentageGrowth)}.`,
    trendDescription,
  }
}

function removeTitleTag(container: HTMLElement | null) {
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
      size: item.size,
      formattedDate: formatDate(new Date(item.date)),
    }))
  }, [filteredStats])

  const trendData = useMemo(() => calculateTrend(filteredStats), [filteredStats])
  const statsSummary = useMemo(() => buildStatsSummary(chartData, timeRange), [chartData, timeRange])

  const overallTrends = useMemo(() => {
    if (stats.length <= 1) {
      return { averageDailyIncrease: 0, totalDays: 0 }
    }
    const firstSize = stats[0].size
    const lastSize = stats[stats.length - 1].size
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
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-sm">Trend:</span>
            <span className={`font-bold ${trendData.growth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {trendData.growth >= 0 ? '+' : ''}
              {trendData.growth} ({trendData.percentage}%)
            </span>
            <span className="text-muted-foreground text-sm">Repositories {statsSummary.trendDescription} over this range.</span>
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Selected Range Summary</CardTitle>
          <CardDescription aria-atomic="true" aria-live="polite" id="stats-chart-summary">
            {statsSummary.summaryText}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="font-medium text-muted-foreground text-sm">Current total</dt>
              <dd className="font-semibold text-lg">{numberFormatter.format(statsSummary.currentTotal)}</dd>
            </div>
            <div>
              <dt className="font-medium text-muted-foreground text-sm">Date range</dt>
              <dd className="text-sm">
                {statsSummary.startDate} to {statsSummary.endDate}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-muted-foreground text-sm">Net growth</dt>
              <dd className="font-semibold text-lg">{formatSignedNumber(statsSummary.netGrowth)}</dd>
            </div>
            <div>
              <dt className="font-medium text-muted-foreground text-sm">Percentage growth</dt>
              <dd className="font-semibold text-lg">{formatSignedPercentage(statsSummary.percentageGrowth)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

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
          <p className="sr-only" id="stats-chart-table-description">
            The table below lists every date and repository count included in the chart.
          </p>
          <ChartContainer
            aria-describedby="stats-chart-summary stats-chart-table-description"
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
          <details className="mt-6 rounded-md border p-4">
            <summary className="cursor-pointer font-medium text-sm">
              Chart data table ({numberFormatter.format(statsSummary.pointCount)} dates)
            </summary>
            <div className="mt-4 max-h-96 overflow-auto">
              <table className="w-full border-collapse text-left text-sm">
                <caption className="sr-only">Repository count chart data for {statsSummary.rangeLabel}</caption>
                <thead>
                  <tr className="border-b">
                    <th className="py-2 pr-4 font-medium" scope="col">
                      Date
                    </th>
                    <th className="py-2 font-medium" scope="col">
                      Repository count
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((item) => (
                    <tr className="border-b last:border-b-0" key={`${item.date}-${item.size}`}>
                      <td className="py-2 pr-4">
                        <time dateTime={item.date}>{item.formattedDate}</time>
                      </td>
                      <td className="py-2 tabular-nums">{numberFormatter.format(item.size)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
  )
}
