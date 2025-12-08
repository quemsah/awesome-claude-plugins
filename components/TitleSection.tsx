'use client'

import { useEffect, useState } from 'react'

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
          const day = date.getDate().toString().padStart(2, '0')
          const month = (date.getMonth() + 1).toString().padStart(2, '0')
          const year = date.getFullYear()
          setLastUpdated(`${day}.${month}.${year}`)
        }
      } catch (error) {
        console.error('Failed to fetch stats:', error)
      }
    })()
  }, [])

  return (
    <div className="space-y-2 text-center mb-8">
      <p className="text-muted-foreground">
        Automated collection of Claude Code plugin adoption metrics across GitHub repositories using n8n workflows
        {lastUpdated ? `. Last updated: ${lastUpdated}` : ''}
      </p>
    </div>
  )
}
