'use client'

import type { components } from '@octokit/openapi-types'
import type { Plugin } from '../../app/types/plugin.type.ts'
import { BackToRepositoriesLink } from '../../components/repo/BackToRepositoriesLink.tsx'
import { PluginCard } from '../../components/repo/PluginCard.tsx'
import { RepoInfoCard } from '../../components/repo/RepoInfoCard.tsx'
import RepoStructuredData from '../../components/repo/RepoStructuredData.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.tsx'
import { getRepoBreadcrumbs } from '../../lib/breadcrumbs.ts'
import { Breadcrumbs } from '../common/Breadcrumbs.tsx'
import { RetryButton } from './RetryButton.tsx'

type Repository = components['schemas']['repository']

type RepoPageClientProps = {
  repoPath: string
  repo: Repository | null
  plugins: Plugin[]
  pluginsError?: string | null
  repoError?: string | null
}

export function RepoPageClient({ repoPath, repo, plugins, pluginsError, repoError }: RepoPageClientProps) {
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
      <RepoStructuredData repo={repo} />
      <div className="container mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <Breadcrumbs items={getRepoBreadcrumbs(repo)} />
        <Button asChild className="mb-6" variant="ghost">
          <BackToRepositoriesLink />
        </Button>

        <RepoInfoCard repo={repo} />

        <Card className="mt-8 p-6">
          <CardHeader className="mb-4 p-0">
            <CardTitle className="text-2xl">
              <h2>Available Plugins</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {pluginsError ? (
              <div className="flex flex-wrap items-center justify-center gap-3 py-4" role="alert">
                <p className="text-destructive">{pluginsError}</p>
                <RetryButton />
                <a
                  className="text-sm underline underline-offset-4"
                  href={`https://raw.githubusercontent.com/${encodeURIComponent(repoPath.split('/')[0])}/${encodeURIComponent(
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
      </div>
    </main>
  )
}
