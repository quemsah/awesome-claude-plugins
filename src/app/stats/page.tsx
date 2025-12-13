'use client'

import { useCallback, useEffect, useState } from 'react'
import { Area, AreaChart, Tooltip, XAxis, YAxis } from 'recharts'
import { Header } from '../../components/common/Header.tsx'
import StatsStructuredData from '../../components/stats/StatsStructuredData.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.tsx'
import { ChartContainer, ChartTooltipContent } from '../../components/ui/chart.tsx'
import { formatDate } from '../../lib/utils.ts'

type StatData = {
  date: string
  size: string
  id: number
}

type ChartData = {
  date: string
  size: number
  formattedDate: string
}

export default function StatsPage() {
  const [chartData, setChartData] = useState<ChartData[]>([])
  const [loading, setLoading] = useState(true)
  const [trends, setTrends] = useState({
    averageDailyIncrease: 0,
    totalDays: 0,
  })

  const processData = useCallback((data: StatData[]) => {
    const sortedData = data.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    const processedData: ChartData[] = sortedData.map((item) => ({
      date: item.date,
      size: parseInt(item.size, 10) || 0,
      formattedDate: formatDate(new Date(item.date)),
    }))

    setChartData(processedData)

    if (processedData.length > 1) {
      const firstSize = processedData[0].size
      const lastSize = processedData[processedData.length - 1].size
      const totalGrowth = lastSize - firstSize
      const totalDays = processedData.length - 1
      const averageDailyIncrease = totalGrowth / totalDays

      setTrends({
        averageDailyIncrease: Math.round(averageDailyIncrease * 100) / 100,
        totalDays,
      })
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        const response = await fetch('/api/stats')
        const data: StatData[] = await response.json()
        processData(data)
      } catch (error) {
        console.error('Failed to fetch stats:', error)
      } finally {
        setLoading(false)
      }
    })()
  }, [processData])

  if (loading) {
    return (
      <main className="min-h-screen bg-background">
        <Header />
        <div className="container mx-auto px-4 py-8">
          <div className="text-center">Loading stats...</div>
        </div>
      </main>
    )
  }

  const startDate = chartData.length > 0 ? chartData[0].date : undefined
  const endDate = chartData.length > 0 ? chartData[chartData.length - 1].date : undefined

  return (
    <main className="min-h-screen bg-background">
      <StatsStructuredData endDate={endDate} startDate={startDate} />
      <Header />
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="mb-2 font-bold text-3xl">Repositories Statistics</h1>
          <p className="text-muted-foreground">The growth of repositories over time</p>
        </div>

        <div className="mb-6 grid gap-6 md:grid-cols-2 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="font-medium text-sm">Total Repositories</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-bold text-2xl">{chartData.length > 0 ? chartData[chartData.length - 1].size : 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="font-medium text-sm">Avg Daily Increase</CardTitle>
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
              className="h-[400px]"
              config={{
                size: {
                  label: 'Repository Count',
                },
              }}
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
                <YAxis
                  aria-label="Repository count"
                  axisLine={false}
                  tickFormatter={(value) => `${value}`}
                  tickLine={false}
                  tickMargin={8}
                />
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
    </main>
  )
}
