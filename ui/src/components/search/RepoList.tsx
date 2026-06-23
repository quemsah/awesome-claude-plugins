'use client'

import type { Repo } from '../../schemas/repo.schema.ts'
import { LoadedContent } from './LoadedContent.tsx'

interface RepoListProps {
  hasLoadError: boolean
  hasMore: boolean
  isLoadingMore: boolean
  loadError: string | null
  onLoadMore: () => void
  sortedRepos: Repo[]
}

export function RepoList({ hasLoadError, hasMore, isLoadingMore, loadError, onLoadMore, sortedRepos }: RepoListProps) {
  if (sortedRepos.length > 0) {
    return (
      <div aria-live="polite">
        <LoadedContent hasMore={hasMore} isLoadingMore={isLoadingMore} onLoadMore={onLoadMore} repos={sortedRepos} />
        {loadError ? <p className="mt-4 text-center text-destructive text-sm">{loadError}</p> : null}
      </div>
    )
  }

  return (
    <div className="py-8 text-center">
      <p className="text-muted-foreground">
        {hasLoadError ? loadError || 'Failed to load repositories. Please try again later' : 'No repositories match your search'}
      </p>
    </div>
  )
}
