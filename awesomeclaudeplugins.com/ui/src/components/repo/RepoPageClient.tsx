/** biome-ignore-all lint/correctness/useExhaustiveDependencies: _retryCount must rerun the effect on retry. */
'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Plugin } from '../../app/types/plugin.type.ts'
import { getMarketplaceName, getStandalonePluginForDisplay, MarketplacePluginsSchema } from '../../app/types/plugin.type.ts'
import { BackToRepositoriesLink } from '../../components/repo/BackToRepositoriesLink.tsx'
import { PluginCard } from '../../components/repo/PluginCard.tsx'
import { RepoInfoCard } from '../../components/repo/RepoInfoCard.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.tsx'
import { useLiveRepository } from '../../hooks/useLiveRepository.ts'
import { getRepoBreadcrumbs } from '../../lib/breadcrumbs.ts'
import { loadRepositoryManifest } from '../../lib/repositoryManifest.ts'
import type { CatalogSnapshotReason } from '../../lib/repositorySnapshot.ts'
import type { GitHubRepository } from '../../schemas/github.schema.ts'
import type { PluginSummary } from '../../schemas/repo.schema.ts'
import { Breadcrumbs } from '../common/Breadcrumbs.tsx'
import { RetryButton } from './RetryButton.tsx'

const CATALOG_SNAPSHOT_NOTICES: Record<CatalogSnapshotReason, string> = {
  'github-not-found':
    'This repository is no longer available on GitHub. It may have been renamed, moved, or deleted. Showing the last catalog snapshot, so some details may be out of date.',
  'github-unavailable':
    'Live GitHub data is temporarily unavailable. Showing the latest catalog snapshot; some details may be out of date.',
}

/** Raw serves `HEAD` as the repository default branch, so the manifest needs no live metadata. */
const MARKETPLACE_REF = 'HEAD'
const MARKETPLACE_LOAD_ERROR = 'Failed to load marketplace manifest. Try again or open the manifest file directly.'
const MARKETPLACE_RATE_LIMIT_ERROR =
  'Failed to load marketplace manifest due to a request limit. Try again later or open the manifest file directly.'

type RepoPageClientProps = {
  apiBaseUrl: string
  repoPath: string
  repo: GitHubRepository
  owner: string
  repoName: string
  rawBaseUrl: string
  manifestKind?: 'marketplace' | 'standalone-plugin'
  catalogPlugins?: PluginSummary[]
}

export function RepoPageClient({
  apiBaseUrl,
  repoPath,
  repo,
  owner,
  repoName,
  rawBaseUrl,
  manifestKind,
  catalogPlugins,
}: RepoPageClientProps) {
  const [loadedKind, setLoadedKind] = useState(manifestKind)
  const [manifestPath, setManifestPath] = useState(
    manifestKind === 'standalone-plugin' ? '.claude-plugin/plugin.json' : '.claude-plugin/marketplace.json'
  )
  const [manifestWarning, setManifestWarning] = useState<string | null>(null)
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [invalidPluginCount, setInvalidPluginCount] = useState(0)
  const [marketplaceName, setMarketplaceName] = useState<string | undefined>(undefined)
  const [pluginsError, setPluginsError] = useState<string | null>(null)
  const [pluginsStatus, setPluginsStatus] = useState<'missing' | 'error' | null>(null)
  const [pluginsLoading, setPluginsLoading] = useState(true)
  const [_retryCount, setRetryCount] = useState(0)
  const { liveRepo, liveReason } = useLiveRepository(apiBaseUrl, { owner, repoName })
  const displayedRepo = liveRepo ?? repo

  const handleRetry = useCallback(() => {
    setRetryCount((count) => count + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    async function loadPlugins() {
      setPluginsLoading(true)
      setPlugins([])
      setInvalidPluginCount(0)
      setMarketplaceName(undefined)
      setPluginsError(null)
      setPluginsStatus(null)

      setManifestWarning(null)
      const result = await loadRepositoryManifest((path) =>
        fetch(`${rawBaseUrl}/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/${MARKETPLACE_REF}/${path}`, {
          signal: controller.signal,
        })
      )
      if (cancelled) return
      setPluginsLoading(false)
      if (result.kind === 'missing') {
        setPluginsStatus('missing')
        return
      }
      setManifestPath(result.path)
      if (result.kind === 'error') {
        if (manifestKind === 'standalone-plugin' && catalogPlugins?.length && result.reason !== 'invalid-content') {
          setLoadedKind('standalone-plugin')
          setPlugins(catalogPlugins.map((plugin) => ({ ...plugin, source: './' })))
          setManifestWarning('Live plugin data is temporarily unavailable. Showing the latest catalog snapshot.')
          return
        }
        setPluginsStatus('error')
        const label = result.path.endsWith('/plugin.json') ? 'Plugin' : 'Marketplace'
        setPluginsError(
          result.reason === 'invalid-content'
            ? `${label} manifest contains invalid data.`
            : result.status === 429
              ? MARKETPLACE_RATE_LIMIT_ERROR
              : MARKETPLACE_LOAD_ERROR
        )
        return
      }
      setLoadedKind(result.kind)
      if (result.kind === 'standalone-plugin') {
        setPlugins([getStandalonePluginForDisplay(result.manifest)])
        return
      }
      const parsed = MarketplacePluginsSchema.safeParse(result.manifest)
      if (!parsed.success) {
        setPluginsStatus('error')
        setPluginsError('Marketplace manifest contains invalid data.')
        return
      }
      setPlugins(parsed.data.plugins)
      setInvalidPluginCount(parsed.data.invalidPluginCount)
      setMarketplaceName(getMarketplaceName(result.manifest))
    }

    loadPlugins()

    return () => {
      // Flag before aborting, as `useLiveRepository` does: the rejection the abort raises must not
      // reach the error state, and the in-flight request must not survive a retry or a navigation.
      cancelled = true
      controller.abort()
    }
  }, [owner, repoName, repoPath, rawBaseUrl, manifestKind, catalogPlugins, _retryCount])

  return (
    <main className="bg-background min-h-dvh" id="main-content" tabIndex={-1}>
      <div className="container mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <Breadcrumbs items={getRepoBreadcrumbs(displayedRepo)} />
        <Button asChild className="mb-6" variant="ghost">
          <BackToRepositoriesLink />
        </Button>

        {liveReason ? (
          <div className="mb-6 rounded-md border border-amber-500/50 bg-amber-500/10 p-4 text-sm" role="status">
            {CATALOG_SNAPSHOT_NOTICES[liveReason]}
          </div>
        ) : null}

        <RepoInfoCard repo={displayedRepo} />

        <Card className="mt-8 p-6">
          <CardHeader className="mb-4 p-0">
            <CardTitle className="text-2xl">
              <h2>Available plugins</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {manifestWarning ? (
              <p className="text-muted-foreground mb-4 text-sm" role="status">
                {manifestWarning}
              </p>
            ) : null}
            {invalidPluginCount > 0 ? (
              <div className="mb-4 flex flex-wrap items-center justify-center gap-3 py-4 text-sm" role="alert">
                <p className="text-destructive">
                  {invalidPluginCount} invalid plugin {invalidPluginCount === 1 ? 'entry was' : 'entries were'} skipped.
                </p>
                <a
                  className="text-sm underline underline-offset-4"
                  href={`${rawBaseUrl}/${encodeURIComponent(repoPath.split('/')[0])}/${encodeURIComponent(
                    repoPath.split('/')[1]
                  )}/HEAD/${manifestPath}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  View {manifestPath.split('/').at(-1)}
                </a>
              </div>
            ) : null}
            {pluginsLoading && !pluginsStatus && !pluginsError ? (
              <p className="text-muted-foreground py-4 text-center" role="status">
                Loading plugins...
              </p>
            ) : pluginsStatus === 'missing' ? (
              <p className="text-muted-foreground py-4 text-center" role="status">
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
                  )}/HEAD/${manifestPath}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  View {manifestPath.split('/').at(-1)}
                </a>
              </div>
            ) : plugins.length > 0 ? (
              <div className="space-y-4">
                {loadedKind === 'standalone-plugin' ? (
                  <a
                    className="text-sm underline"
                    href={`${rawBaseUrl}/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/HEAD/.claude-plugin/plugin.json`}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    View plugin.json
                  </a>
                ) : null}
                {plugins.map((plugin, index) => (
                  <article key={`${plugin.id || ''}-${plugin.name || ''}-${index}`}>
                    <PluginCard
                      manifestKind={loadedKind}
                      marketplaceName={marketplaceName}
                      plugin={plugin}
                      repo={displayedRepo}
                      repoPath={repoPath}
                    />
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground py-4 text-center" role="status">
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
          <CardContent className="text-muted-foreground p-0 pt-4 text-sm">
            <ol className="list-decimal space-y-2 pl-5">
              <li>Review the source repository, recent maintenance, and license on GitHub.</li>
              <li>
                Read the {loadedKind === 'standalone-plugin' ? 'plugin' : 'marketplace'} manifest and plugin source files before running
                commands.
              </li>
              <li>Start with the smallest required permission set and validate behavior in a safe environment.</li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
