'use client'

import type { Repo } from '../../schemas/repo.schema.ts'
import { LoadedContent } from './LoadedContent.tsx'
import type { SortOption } from './Sort.tsx'

interface RepoListProps {
  activeFilterSummary: string
  hasLoadError: boolean
  onClearFilters: () => void
  sortedRepos: Repo[]
  sortOption: SortOption
}

export function RepoList({ activeFilterSummary, hasLoadError, onClearFilters, sortedRepos, sortOption }: RepoListProps) {
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
        {hasLoadError ? 'Failed to load repositories. Please try again later' : 'No repositories match your search'}
      </p>
      {activeFilterSummary ? (
        <button className="mt-3 text-sm underline-offset-4 hover:underline" onClick={onClearFilters} type="button">
          Clear {activeFilterSummary} filters
        </button>
      ) : null}
    </div>
  )
}
