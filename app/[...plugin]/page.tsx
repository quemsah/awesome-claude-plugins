'use client'

import type { components } from '@octokit/openapi-types'
import Link from 'next/link'
import { use, useEffect, useState } from 'react'
import { CodeIcon, ExternalLinkIcon, EyeIcon, ForkIcon, IssueIcon, LicenseIcon, StarIcon } from '../../components/Icons.tsx'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar.tsx'
import { Badge } from '../../components/ui/badge.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.tsx'
import { Separator } from '../../components/ui/separator.tsx'

type RouteParams = { params: Promise<{ plugin: string[] }> }
type Repository = components['schemas']['repository']

export default function PluginPage({ params }: RouteParams) {
  const resolvedParams = use(params)
  const [plugin, setPlugin] = useState<Repository | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const pluginPath = resolvedParams.plugin.join('/')

  useEffect(() => {
    ;(async () => {
      try {
        const resp = await fetch(`https://api.github.com/repos/${pluginPath}`)
        if (!resp.ok) {
          if (resp.status === 404) {
            setError('Plugin not found')
          } else {
            setError('Failed to load plugin')
          }
          return
        }
        const data = (await resp.json()) as Repository
        setPlugin(data)
      } catch {
        setError('Failed to load plugin')
      } finally {
        setLoading(false)
      }
    })()
  }, [pluginPath])

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

  const formatSize = (size: number | null) => {
    if (!size) return 'Unknown'
    const kb = size
    if (kb < 1024) return `${kb} KB`
    const mb = kb / 1024
    return `${mb.toFixed(1)} MB`
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
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16">
                  <AvatarImage src={plugin.owner.avatar_url} alt={plugin.owner.login} />
                  <AvatarFallback>{plugin.owner.login.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div>
                  <CardTitle className="text-3xl mb-2">{plugin.name}</CardTitle>
                  <CardDescription className="text-lg">
                    <a
                      href={plugin.owner.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-primary transition-colors"
                    >
                      by {plugin.owner.login}
                    </a>
                  </CardDescription>
                </div>
              </div>
              <div className="flex gap-2">
                {plugin.homepage && (
                  <Button variant="outline" asChild>
                    <a href={plugin.homepage} target="_blank" rel="noopener noreferrer">
                      <ExternalLinkIcon />
                      Homepage
                    </a>
                  </Button>
                )}
                <Button asChild>
                  <a href={plugin.html_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLinkIcon />
                    View on GitHub
                  </a>
                </Button>
              </div>
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
                <span className="font-semibold">{plugin.watchers_count?.toLocaleString() ?? 0}</span>
                <span>watchers</span>
              </Badge>
              <Badge variant="secondary" className="gap-2">
                <IssueIcon />
                <span className="font-semibold">{plugin.open_issues_count?.toLocaleString() ?? 0}</span>
                <span>issues</span>
              </Badge>
            </div>

            {plugin.topics && plugin.topics.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-6">
                {plugin.topics.map((topic) => (
                  <Badge key={topic} variant="outline">
                    {topic}
                  </Badge>
                ))}
              </div>
            )}

            <Separator className="mb-6" />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {plugin.language && (
                <div>
                  <dt className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <CodeIcon />
                    Language
                  </dt>
                  <dd className="text-foreground">{plugin.language}</dd>
                </div>
              )}
              {plugin.license && (
                <div>
                  <dt className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <LicenseIcon />
                    License
                  </dt>
                  <dd className="text-foreground">{plugin.license.name}</dd>
                </div>
              )}
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Size</dt>
                <dd className="text-foreground">{formatSize(plugin.size)}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Created</dt>
                <dd className="text-foreground">{formatDate(plugin.created_at)}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Last Updated</dt>
                <dd className="text-foreground">{formatDate(plugin.updated_at)}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Last Pushed</dt>
                <dd className="text-foreground">{formatDate(plugin.pushed_at)}</dd>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
