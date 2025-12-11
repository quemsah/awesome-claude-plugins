'use client'

import { useEffect, useState } from 'react'
import { formatDate } from '../../lib/utils.ts'

interface StatsEntry {
  date: string
  size: string
  id: number
}

export function TitleSection() {
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const response = await fetch('/api/stats')
        const stats = (await response.json()) as StatsEntry[]
        if (stats.length > 0) {
          const lastEntry = stats[stats.length - 1]
          const date = new Date(lastEntry.date)
          setLastUpdated(formatDate(date))
        }
      } catch (error) {
        console.error('Failed to fetch stats:', error)
      }
    })()
  }, [])

  return (
    <div className="space-y-2 text-center mb-8">
      <h1 className="text-3xl font-bold mb-2">Awesome Claude Plugins</h1>
      <p className="text-muted-foreground">
        Automated collection of Claude Code plugin adoption metrics across GitHub repositories using n8n workflows
        {lastUpdated ? `. Last updated: ${lastUpdated}` : ''}
      </p>
    </div>
  )
}
