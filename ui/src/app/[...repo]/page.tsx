import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { Header } from '../../components/common/Header.tsx'
import { PluginCard } from '../../components/repo/PluginCard.tsx'
import { RepoInfoCard } from '../../components/repo/RepoInfoCard.tsx'
import RepoStructuredData from '../../components/repo/RepoStructuredData.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.tsx'
import { fetchRepoDetails, fetchRepoPlugins, parseRepoPath } from '../../lib/repoDetails.ts'

type RouteParams = { params: Promise<{ repo: string[] }> }

export default async function RepoPage({ params }: RouteParams) {
  const resolvedParams = await params
  const repoPath = parseRepoPath(resolvedParams.repo)

  if (!repoPath) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Card className="p-8 text-center">
          <CardHeader>
            <CardTitle>Repository not found</CardTitle>
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

  const { repo, error } = await fetchRepoDetails(repoPath)

  if (error || !repo) {
    return <RepoErrorMessage message={error || 'Repository not found'} />
  }

  const { plugins, error: pluginsError } = await fetchRepoPlugins(repoPath, repo.default_branch)

  return (
    <>
      <Header />
      <main className="min-h-screen bg-background">
        {repo ? <RepoStructuredData repo={repo} /> : null}
        <div className="container mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
          <Button aria-label="Back to all repositories" asChild className="mb-6" variant="ghost">
            <Link href="/">
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              Back to all repositories
            </Link>
          </Button>

          <RepoInfoCard repo={repo} />

          <Card className="mt-8 p-6">
            <CardHeader className="mb-4 p-0">
              <CardTitle className="text-2xl">
                <h2>Available Plugins</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {pluginsError ? <p className="py-4 text-center text-muted-foreground">{pluginsError}</p> : null}
              {!pluginsError && plugins.length > 0 ? (
                <div aria-atomic="true" aria-live="polite" className="space-y-4">
                  {plugins.map((plugin, index) => (
                    <article key={`${plugin.id || ''}-${plugin.name || ''}-${index}`}>
                      <PluginCard plugin={plugin} repo={repo} repoPath={repoPath} />
                    </article>
                  ))}
                </div>
              ) : null}
              {!pluginsError && plugins.length === 0 ? (
                <p aria-live="polite" className="py-4 text-center text-muted-foreground">
                  No Claude Code plugins found in this repository.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  )
}

function RepoErrorMessage({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background">
      <Card className="p-8 text-center">
        <CardHeader>
          <CardTitle>{message}</CardTitle>
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
