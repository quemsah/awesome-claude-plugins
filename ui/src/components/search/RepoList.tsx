'use client'

import type { Repo } from '../../schemas/repo.schema.ts'
import { LoadedContent } from './LoadedContent.tsx'

interface RepoListProps {
  hasLoadError: boolean
  hasMore: boolean
  isLoading: boolean
  onLoadMore: () => void
  sortedRepos: Repo[]
}

export function RepoList({ hasLoadError, hasMore, isLoading, onLoadMore, sortedRepos }: RepoListProps) {
  if (sortedRepos.length > 0) {
    return (
      <div>
        <LoadedContent hasMore={hasMore} isLoading={isLoading} onLoadMore={onLoadMore} repos={sortedRepos} />
      </div>
    )
  }

  return (
    <div className="py-8 text-center">
      <p className="text-muted-foreground">
        {hasLoadError ? 'Failed to load repositories. Please try again later' : 'No repositories match your search'}
      </p>
      <p aria-live="polite" className="sr-only" role="status">
        {hasLoadError ? 'Repository search failed.' : 'Repository search returned no matches.'}
      </p>
    </div>
  )
}
