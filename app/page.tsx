'use client'

import { useEffect, useState } from 'react'
import { Header } from '../components/header.tsx'
import { LoadedContent } from '../components/loaded-content.tsx'
import { LoadingContent } from '../components/loading-content.tsx'
import { TitleSection } from '../components/title-section.tsx'
import type { Plugin } from './types/plugin.type.ts'

export default function Home() {
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      try {
        const response = await fetch(`/api/plugins`)
        const allPlugins = (await response.json()) as Plugin[]
        setPlugins(allPlugins)
      } catch (error) {
        console.error('Failed to fetch plugins:', error)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  return (
    <main className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto px-4 py-8">
        <TitleSection pluginsLength={loading ? undefined : plugins.length} />
        {loading ? <LoadingContent /> : <LoadedContent plugins={plugins} />}
      </div>
    </main>
  )
}
