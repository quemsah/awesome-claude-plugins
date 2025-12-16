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
        const response = await fetch('/api/stats/last-updated')
        if (!response.ok) {
          throw new Error('Network response was not ok')
        }
        const lastEntry = (await response.json()) as StatsEntry | null
        if (lastEntry) {
          const date = new Date(lastEntry.date)
          setLastUpdated(formatDate(date))
        }
      } catch (error) {
        console.error('Failed to fetch stats:', error)
      }
    })()
  }, [])

  return (
    <div className="mb-8 space-y-2 text-center">
      <h1 className="mb-2 font-bold text-3xl">Awesome Claude Plugins</h1>
      <p className="text-muted-foreground">
        Automated collection of Claude Code plugin adoption metrics across GitHub repositories using n8n workflows
        {lastUpdated ? `. Last updated: ${lastUpdated}` : ''}
      </p>
    </div>
  )
}
