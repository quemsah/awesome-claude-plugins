'use client'

import { useEffect, useState } from 'react'
import { Header } from '../components/Header.tsx'
import { LoadedContent } from '../components/LoadedContent.tsx'
import { LoadingContent } from '../components/LoadingContent.tsx'
import { TitleSection } from '../components/TitleSection.tsx'
import { Separator } from '../components/ui/separator.tsx'
import type { Plugin } from './types.ts'

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
        <Separator className="mb-8" />
        {loading ? <LoadingContent /> : <LoadedContent plugins={plugins} />}
      </div>
    </main>
  )
}
