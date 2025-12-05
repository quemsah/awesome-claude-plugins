'use client'

import { useEffect, useState, use } from 'react'
import type { Plugin } from '../types.ts'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Badge } from '../../components/ui/badge.tsx'
import { Separator } from '../../components/ui/separator.tsx'
import { StarIcon, ForkIcon, EyeIcon, ExternalLinkIcon } from '../../components/Icons.tsx'

type RouteParams = { params: Promise<{ plugin: string }> }

export default function PluginPage({ params }: RouteParams) {
  const resolvedParams = use(params)
  const [plugin, setPlugin] = useState<Plugin | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const resp = await fetch(`/api/plugins/${resolvedParams.plugin}`)
        if (!resp.ok) {
          setError('Plugin not found')
          return
        }
        const data = (await resp.json()) as Plugin
        setPlugin(data)
      } catch {
        setError('Failed to load plugin')
      } finally {
        setLoading(false)
      }
    })()
  }, [resolvedParams.plugin])

  if (loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground mt-2">Loading plugin...</p>
        </div>
      </main>
    )
  }

  if (error || !plugin) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <Card className="text-center p-8">
          <CardHeader>
            <CardTitle>{error || 'Plugin not found'}</CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/">← Back to all plugins</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Unknown'
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Button variant="ghost" asChild className="mb-6">
          <Link href="/">← Back to all plugins</Link>
        </Button>

        <Card className="p-8">
          <CardHeader className="p-0 mb-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-3xl mb-2">{plugin.repo_name}</CardTitle>
                <CardDescription className="text-lg">
                  <a
                    href={plugin.owner_url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-primary transition-colors"
                  >
                    by {plugin.owner}
                  </a>
                </CardDescription>
              </div>
              <Button asChild>
                <a href={plugin.html_url} target="_blank" rel="noopener noreferrer">
                  <ExternalLinkIcon />
                  View on GitHub
                </a>
              </Button>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {plugin.description && <p className="text-lg mb-6 text-muted-foreground">{plugin.description}</p>}

            <div className="flex flex-wrap gap-4 mb-6">
              <Badge variant="secondary" className="gap-2">
                <StarIcon />
                <span className="font-semibold">{plugin.stargazers_count?.toLocaleString() ?? 0}</span>
                <span>stars</span>
              </Badge>
              <Badge variant="secondary" className="gap-2">
                <ForkIcon />
                <span className="font-semibold">{plugin.forks_count?.toLocaleString() ?? 0}</span>
                <span>forks</span>
              </Badge>
              <Badge variant="secondary" className="gap-2">
                <EyeIcon />
                <span className="font-semibold">{plugin.subscribers_count?.toLocaleString() ?? 0}</span>
                <span>watchers</span>
              </Badge>
            </div>

            <Separator className="mb-6" />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Last Updated</dt>
                <dd className="text-foreground">{formatDate(plugin.repo_updated)}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Added to Catalog</dt>
                <dd className="text-foreground">{formatDate(plugin.createdAt)}</dd>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
