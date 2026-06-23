'use client'

import type { Repo } from '../../schemas/repo.schema.ts'
import { LoadedContent } from './LoadedContent.tsx'

interface RepoListProps {
  hasLoadError: boolean
  resetKey: string
  sortedRepos: Repo[]
}

export function RepoList({ hasLoadError, resetKey, sortedRepos }: RepoListProps) {
  if (sortedRepos.length > 0) {
    return (
      <div aria-live="polite">
        <LoadedContent repos={sortedRepos} resetKey={resetKey} />
      </div>
    )
  }

  return (
    <div className="py-8 text-center">
      <p className="text-muted-foreground">
        {hasLoadError ? 'Failed to load repositories. Please try again later' : 'No repositories match your search'}
      </p>
    </div>
  )
}
