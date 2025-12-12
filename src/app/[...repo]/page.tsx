'use client'

import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { use } from 'react'
import { Header } from '../../components/common/Header.tsx'
import { PluginCard } from '../../components/repo/PluginCard.tsx'
import { RepoInfoCard } from '../../components/repo/RepoInfoCard.tsx'
import RepoStructuredData from '../../components/repo/RepoStructuredData.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.tsx'
import { usePlugins } from '../../hooks/usePlugins.ts'
import { useRepo } from '../../hooks/useRepo.ts'

type RouteParams = { params: Promise<{ repo: string[] }> }

export default function RepoPage({ params }: RouteParams) {
  const resolvedParams = use(params)
  const repoPath = resolvedParams.repo.join('/')

  const { repo, loading, error } = useRepo(repoPath)
  const { plugins, pluginsLoading, pluginsError } = usePlugins(repo, repoPath)

  if (loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
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

  return (
    <>
      <Header />
      <main className="min-h-screen bg-background">
        {repo ? <RepoStructuredData repo={repo} /> : null}
        <div className="container mx-auto px-4 py-8 max-w-4xl">
          <Button aria-label="Back to all repositories" asChild className="mb-6" variant="ghost">
            <Link href="/">
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              Back to all repositories
            </Link>
          </Button>

          <RepoInfoCard repo={repo} />

          {!pluginsError && (
            <Card className="mt-8 p-6">
              <CardHeader className="p-0 mb-4">
                <CardTitle className="text-2xl">Available Plugins</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {pluginsLoading ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto" />
                    <p className="text-muted-foreground mt-2">Loading plugins...</p>
                  </div>
                ) : plugins.length > 0 ? (
                  <div className="space-y-4">
                    {plugins.map((plugin, index) => (
                      <PluginCard
                        key={`${plugin.id || ''}-${plugin.name || ''}-${index}`}
                        plugin={plugin}
                        repo={repo}
                        repoPath={repoPath}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-4">No plugins found in this repository.</p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </>
  )
}
