/** biome-ignore-all lint/correctness/useExhaustiveDependencies: _retryCount must rerun the effect on retry. */
'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Plugin } from '../../app/types/plugin.type.ts'
import { MarketplacePluginsSchema } from '../../app/types/plugin.type.ts'
import { BackToRepositoriesLink } from '../../components/repo/BackToRepositoriesLink.tsx'
import { PluginCard } from '../../components/repo/PluginCard.tsx'
import { RepoInfoCard } from '../../components/repo/RepoInfoCard.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.tsx'
import { getRepoBreadcrumbs } from '../../lib/breadcrumbs.ts'
import type { GitHubRepository } from '../../schemas/github.schema.ts'
import { Breadcrumbs } from '../common/Breadcrumbs.tsx'
import { RetryButton } from './RetryButton.tsx'

type RepoPageClientProps = {
  repoPath: string
  repo: GitHubRepository | null
  owner: string
  repoName: string
  defaultBranch: string
  rawBaseUrl: string
  repoError?: string | null
  repoIsStale?: boolean
}

export function RepoPageClient({
  repoPath,
  repo,
  owner,
  repoName,
  defaultBranch,
  rawBaseUrl,
  repoError,
  repoIsStale = false,
}: RepoPageClientProps) {
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [pluginsError, setPluginsError] = useState<string | null>(null)
  const [pluginsStatus, setPluginsStatus] = useState<'missing' | 'error' | null>(null)
  const [pluginsLoading, setPluginsLoading] = useState(true)
  const [_retryCount, setRetryCount] = useState(0)

  const handleRetry = useCallback(() => {
    setRetryCount((count) => count + 1)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadPlugins() {
      setPluginsLoading(true)
      setPlugins([])
      setPluginsError(null)
      setPluginsStatus(null)

      try {
        const response = await fetch(
          `${rawBaseUrl}/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/${encodeURIComponent(defaultBranch)}/.claude-plugin/marketplace.json`
        )

        if (response.status === 404) {
          if (!cancelled) setPluginsStatus('missing')
          if (!cancelled) setPluginsLoading(false)
          return
        }

        if (!response.ok) {
          if (!cancelled) {
            setPluginsStatus('error')
            setPluginsError('Failed to load marketplace manifest.')
            setPluginsLoading(false)
          }
          return
        }

        try {
          const parsedMarketplace = MarketplacePluginsSchema.safeParse(await response.json())
          if (parsedMarketplace.success) {
            if (!cancelled) {
              setPlugins(parsedMarketplace.data)
              setPluginsLoading(false)
            }
          } else {
            if (!cancelled) {
              console.error('Marketplace validation failed', { repoPath, issues: parsedMarketplace.error.issues })
              setPluginsStatus('error')
              setPluginsError('Marketplace manifest contains invalid data.')
              setPluginsLoading(false)
            }
          }
        } catch (error) {
          if (!cancelled) {
            console.error('Marketplace parsing failed', { repoPath, error })
            setPluginsStatus('error')
            setPluginsError('Marketplace manifest contains invalid data.')
            setPluginsLoading(false)
          }
        }
      } catch (_error) {
        if (!cancelled) {
          setPluginsStatus('error')
          setPluginsError('Failed to load marketplace manifest.')
          setPluginsLoading(false)
        }
      }
    }

    loadPlugins()

    return () => {
      cancelled = true
    }
  }, [owner, repoName, defaultBranch, repoPath, rawBaseUrl, _retryCount])
  if (!repo) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background" id="main-content" tabIndex={-1}>
        <Card className="p-8 text-center" role="alert">
          <CardHeader>
            <CardTitle>
              <h1>{pluginsError ?? repoError ?? 'Repository not found'}</h1>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <BackToRepositoriesLink />
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <main className="min-h-dvh bg-background" id="main-content" tabIndex={-1}>
      <div className="container mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <Breadcrumbs items={getRepoBreadcrumbs(repo)} />
        <Button asChild className="mb-6" variant="ghost">
          <BackToRepositoriesLink />
        </Button>

        {repoIsStale ? (
          <div className="mb-6 rounded-md border border-amber-500/50 bg-amber-500/10 p-4 text-sm" role="status">
            Live GitHub data is temporarily unavailable. Showing the latest catalog snapshot; some details may be out of date.
          </div>
        ) : null}

        <RepoInfoCard repo={repo} />

        <Card className="mt-8 p-6">
          <CardHeader className="mb-4 p-0">
            <CardTitle className="text-2xl">
              <h2>Available Plugins</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {pluginsLoading && !pluginsStatus && !pluginsError ? (
              <p className="py-4 text-center text-muted-foreground" role="status">
                Loading plugins...
              </p>
            ) : pluginsStatus === 'missing' ? (
              <p className="py-4 text-center text-muted-foreground" role="status">
                No marketplace manifest was found in this repository.
              </p>
            ) : pluginsError ? (
              <div className="flex flex-wrap items-center justify-center gap-3 py-4" role="alert">
                <p className="text-destructive">{pluginsError}</p>
                <RetryButton onRetry={handleRetry} />
                <a
                  className="text-sm underline underline-offset-4"
                  href={`${rawBaseUrl}/${encodeURIComponent(repoPath.split('/')[0])}/${encodeURIComponent(
                    repoPath.split('/')[1]
                  )}/HEAD/.claude-plugin/marketplace.json`}
                  rel="noreferrer"
                  target="_blank"
                >
                  View marketplace.json
                </a>
              </div>
            ) : plugins.length > 0 ? (
              <div className="space-y-4">
                {plugins.map((plugin, index) => (
                  <article key={`${plugin.id || ''}-${plugin.name || ''}-${index}`}>
                    <PluginCard plugin={plugin} repo={repo} repoPath={repoPath} />
                  </article>
                ))}
              </div>
            ) : (
              <p className="py-4 text-center text-muted-foreground" role="status">
                No Claude Code plugins found in this repository.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="mt-8 p-6">
          <CardHeader className="p-0">
            <CardTitle className="text-2xl">
              <h2>Evaluate before installing</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 pt-4 text-muted-foreground text-sm">
            <ol className="list-decimal space-y-2 pl-5">
              <li>Review the source repository, recent maintenance, and license on GitHub.</li>
              <li>Read the marketplace manifest and plugin source files before running commands.</li>
              <li>Start with the smallest required permission set and validate behavior in a safe environment.</li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
