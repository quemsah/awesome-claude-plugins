'use client'

import type { Repo } from '../../schemas/repo.schema.ts'
import { LoadedContent } from './LoadedContent.tsx'
import type { SortOption } from './Sort.tsx'

interface RepoListProps {
  hasLoadError: boolean
  sortedRepos: Repo[]
  sortOption: SortOption
}

export function RepoList({ hasLoadError, sortedRepos, sortOption }: RepoListProps) {
  if (sortedRepos.length > 0) {
    return (
      <div aria-live="polite">
        <LoadedContent repos={sortedRepos} sortOption={sortOption} />
      </div>
    )
  }

  return (
    <div className="py-8 text-center">
      <p className="text-muted-foreground">
        {hasLoadError ? 'Failed to load repositories. Please try again later.' : 'No repositories match your search.'}
      </p>
    </div>
  )
}
