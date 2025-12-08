'use client'

import type { components } from '@octokit/openapi-types'
import { ArrowLeft, CircleDot, Code, ExternalLink, Eye, FileText, GitFork, Star } from 'lucide-react'
import Link from 'next/link'
import { use, useEffect, useState } from 'react'
import { Header } from '../../components/Header.tsx'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar.tsx'
import { Badge } from '../../components/ui/badge.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.tsx'
import { formatDate as formatDateUtil } from '../../lib/utils.ts'

type RouteParams = { params: Promise<{ repo: string[] }> }
type Repository = components['schemas']['repository']

export default function RepoPage({ params }: RouteParams) {
  const resolvedParams = use(params)
  const [repo, setRepo] = useState<Repository | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const repoPath = resolvedParams.repo.join('/')
  useEffect(() => {
    ;(async () => {
      try {
        const resp = await fetch(`https://api.github.com/repos/${repoPath}`)
        if (!resp.ok) {
          if (resp.status === 404) {
            setError('Repository not found')
          } else {
            setError('Failed to load repository')
          }
          return
        }
        const data = (await resp.json()) as Repository
        setRepo(data)
      } catch {
        setError('Failed to load repository')
      } finally {
        setLoading(false)
      }
    })()
  }, [repoPath])

  if (loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground mt-2">Loading repository...</p>
        </div>
      </main>
    )
  }

  if (error || !repo) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <Card className="text-center p-8">
          <CardHeader>
            <CardTitle>{error || 'Repository not found'}</CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/">
                <ArrowLeft className="h-4 w-4" />
                Back to all repositories
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Unknown'
    return formatDateUtil(new Date(dateString))
  }

  const formatSize = (size: number | null) => {
    if (!size) return 'Unknown'
    const kb = size
    if (kb < 1024) return `${kb} KB`
    const mb = kb / 1024
    return `${mb.toFixed(1)} MB`
  }

  return (
    <>
      <Header />
      <main className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8 max-w-4xl">
          <Button variant="ghost" asChild className="mb-6">
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
              Back to all repositories
            </Link>
          </Button>

          <Card className="p-8">
            <CardHeader className="p-0 mb-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <Avatar className="h-16 w-16">
                    <AvatarImage src={repo.owner.avatar_url} alt={repo.owner.login} />
                    <AvatarFallback>{repo.owner.login.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div>
                    <CardTitle className="text-3xl mb-2">{repo.name}</CardTitle>
                    <CardDescription className="text-lg">
                      <a
                        href={repo.owner.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-primary transition-colors"
                      >
                        by {repo.owner.login}
                      </a>
                    </CardDescription>
                  </div>
                </div>
                <div className="flex gap-2">
                  {repo.homepage && (
                    <Button variant="outline" asChild>
                      <a href={repo.homepage} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4" />
                        Homepage
                      </a>
                    </Button>
                  )}
                  <Button asChild>
                    <a href={repo.html_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                      View on GitHub
                    </a>
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {repo.description && <p className="text-lg mb-6 text-muted-foreground">{repo.description}</p>}

              <div className="flex flex-wrap gap-4 mb-6">
                <Badge variant="secondary" className="gap-2">
                  <Star className="h-4 w-4" />
                  <span className="font-semibold">{repo.stargazers_count?.toLocaleString() ?? 0}</span>
                  <span>stars</span>
                </Badge>
                <Badge variant="secondary" className="gap-2">
                  <GitFork className="h-4 w-4" />
                  <span className="font-semibold">{repo.forks_count?.toLocaleString() ?? 0}</span>
                  <span>forks</span>
                </Badge>
                <Badge variant="secondary" className="gap-2">
                  <Eye className="h-4 w-4" />
                  <span className="font-semibold">{repo.watchers_count?.toLocaleString() ?? 0}</span>
                  <span>watchers</span>
                </Badge>
                <Badge variant="secondary" className="gap-2">
                  <CircleDot className="h-4 w-4" />
                  <span className="font-semibold">{repo.open_issues_count?.toLocaleString() ?? 0}</span>
                  <span>issues</span>
                </Badge>
              </div>

              {repo.topics && repo.topics.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-6">
                  {repo.topics.map((topic) => (
                    <Badge key={topic} variant="outline">
                      {topic}
                    </Badge>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {repo.language && (
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <Code className="h-4 w-4" />
                      Language
                    </dt>
                    <dd className="text-foreground">{repo.language}</dd>
                  </div>
                )}
                {repo.license && (
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      License
                    </dt>
                    <dd className="text-foreground">{repo.license.name}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">Size</dt>
                  <dd className="text-foreground">{formatSize(repo.size)}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">Created</dt>
                  <dd className="text-foreground">{formatDate(repo.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">Last Updated</dt>
                  <dd className="text-foreground">{formatDate(repo.updated_at)}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">Last Pushed</dt>
                  <dd className="text-foreground">{formatDate(repo.pushed_at)}</dd>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  )
}
