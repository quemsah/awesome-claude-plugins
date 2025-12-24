'use client'

import type { Repo } from '../../schemas/repo.schema.ts'
import { LoadedContent } from './LoadedContent.tsx'
import { LoadingContent } from './LoadingContent.tsx'
import type { SortOption } from './Sort.tsx'

interface RepoListProps {
  repos: Repo[]
  sortedRepos: Repo[]
  isLoading: boolean
  sortOption: SortOption
}

export function RepoList({ repos, sortedRepos, isLoading, sortOption }: RepoListProps) {
  if (isLoading) {
    return (
      <div aria-busy="true" aria-live="polite">
        <LoadingContent />
      </div>
    )
  }

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
        {repos.length === 0 ? 'Failed to load repositories. Please try again later.' : 'No repositories match your search.'}
      </p>
    </div>
  )
}
