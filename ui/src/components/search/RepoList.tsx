'use client'

import type { Repo } from '../../schemas/repo.schema.ts'
import { LoadedContent } from './LoadedContent.tsx'
import type { SortOption } from './Sort.tsx'

interface RepoListProps {
  hasLoadError: boolean
  searchTerm: string
  sortedRepos: Repo[]
  sortOption: SortOption
}

export function RepoList({ hasLoadError, searchTerm, sortedRepos, sortOption }: RepoListProps) {
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
        {hasLoadError
          ? 'Failed to load repositories. Please try again later'
          : searchTerm
            ? 'No repositories match your search across names, descriptions, owners, owner/repo paths, or plugin counts'
            : 'No repositories match your search'}
      </p>
    </div>
  )
}
