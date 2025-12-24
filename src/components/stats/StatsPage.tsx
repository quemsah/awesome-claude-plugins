'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Area, AreaChart, Tooltip, XAxis, YAxis } from 'recharts'
import { formatDate } from '../../lib/utils.ts'
import type { StatsItem } from '../../schemas/stats.schema.ts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card.tsx'
import { ChartContainer, ChartTooltipContent } from '../ui/chart.tsx'

interface StatsPageProps {
  stats: StatsItem[]
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

  const chartData = useMemo(() => {
    const sortedData = [...stats].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    return sortedData.map((item) => ({
      date: item.date,
      size: Number.parseInt(item.size, 10) || 0,
      formattedDate: formatDate(new Date(item.date)),
    }))
  }, [stats])

  const trends = useMemo(() => {
    if (chartData.length <= 1) {
      return { averageDailyIncrease: 0, totalDays: 0 }
    }
    const firstSize = chartData[0].size
    const lastSize = chartData[chartData.length - 1].size
    const totalGrowth = lastSize - firstSize
    const totalDays = chartData.length - 1
    return {
      averageDailyIncrease: Math.round((totalGrowth / totalDays) * 100) / 100,
      totalDays,
    }
  }, [chartData])

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
            <div className="font-bold text-2xl">+{trends.averageDailyIncrease}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Repository Count Over Time</CardTitle>
          <CardDescription>
            Daily repository count from {chartData.length > 0 ? chartData[0].formattedDate : ''} to{' '}
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
