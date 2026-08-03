'use client'

import Link from 'next/link'
import type { Plugin } from '../../app/types/plugin.type.ts'
import { BackToRepositoriesLink } from '../../components/repo/BackToRepositoriesLink.tsx'
import { PluginCard } from '../../components/repo/PluginCard.tsx'
import { RepoInfoCard } from '../../components/repo/RepoInfoCard.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.tsx'
import { getRepoBreadcrumbs } from '../../lib/breadcrumbs.ts'
import { getGitHubRepoPath } from '../../lib/repositoryIdentity.ts'
import type { GitHubRepository } from '../../schemas/github.schema.ts'
import type { Repo } from '../../schemas/repo.schema.ts'
import { Breadcrumbs } from '../common/Breadcrumbs.tsx'
import { RetryButton } from './RetryButton.tsx'

type RepoPageClientProps = {
  repoPath: string
  repo: GitHubRepository | null
  plugins: Plugin[]
  pluginsError?: string | null
  pluginsStatus?: 'missing' | 'error' | null
  repoError?: string | null
  repoIsStale?: boolean
  relatedRepos?: readonly Repo[]
}

export function RepoPageClient({
  repoPath,
  repo,
  plugins,
  pluginsError,
  pluginsStatus,
  repoError,
  repoIsStale = false,
  relatedRepos = [],
}: RepoPageClientProps) {
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
            {pluginsStatus === 'missing' ? (
              <p className="py-4 text-center text-muted-foreground" role="status">
                No marketplace manifest was found in this repository.
              </p>
            ) : pluginsError ? (
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

        <section aria-labelledby="related-repositories" className="mt-8">
          <h2 className="mb-4 font-semibold text-2xl" id="related-repositories">
            Related repositories
          </h2>
          {relatedRepos.length > 0 ? (
            <ul className="grid gap-4 sm:grid-cols-3">
              {relatedRepos.map((relatedRepo) => (
                <li className="rounded-lg border p-4" key={relatedRepo.id}>
                  <Link
                    className="font-medium text-foreground underline-offset-4 hover:text-primary hover:underline"
                    href={`/${getGitHubRepoPath(relatedRepo.owner ?? '', relatedRepo.repo_name ?? '')}`}
                  >
                    {relatedRepo.owner}/{relatedRepo.repo_name}
                  </Link>
                  <p className="mt-2 line-clamp-3 text-muted-foreground text-sm">{relatedRepo.description}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">No closely related catalog entries were found.</p>
          )}
        </section>
      </div>
    </main>
  )
}
