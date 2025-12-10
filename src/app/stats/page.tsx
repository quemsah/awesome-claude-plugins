'use client'

import { useCallback, useEffect, useState } from 'react'
import { Area, AreaChart, Tooltip, XAxis, YAxis } from 'recharts'
import { Header } from '../../components/Header.tsx'
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

  return (
    <main className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Repositories Statistics</h1>
          <p className="text-muted-foreground">The growth of repositories over time</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Repositories</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{chartData.length > 0 ? chartData[chartData.length - 1].size : 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Daily Increase</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">+{trends.averageDailyIncrease}</div>
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
              className="h-[400px]"
              config={{
                size: {
                  label: 'Repository Count',
                },
              }}
            >
              <AreaChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="fillSize" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <XAxis axisLine={false} dataKey="formattedDate" tickFormatter={(value) => value} tickLine={false} tickMargin={8} />
                <YAxis axisLine={false} tickFormatter={(value) => `${value}`} tickLine={false} tickMargin={8} />
                <Tooltip content={<ChartTooltipContent />} />
                <Area
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
