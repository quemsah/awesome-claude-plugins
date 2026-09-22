'use client'

import type { PendingCatalogLoad } from '../../lib/searchState.ts'
import type { Repo } from '../../schemas/repo.schema.ts'
import { RetryButton } from '../repo/RetryButton.tsx'
import { LoadedContent } from './LoadedContent.tsx'

interface RepoListProps {
  hasLoadError: boolean
  hasMore: boolean
  onLoadMore: () => void
  onRetry: () => void
  pendingLoad: PendingCatalogLoad
  replaceCompletion: number
  sortedRepos: Repo[]
}

const searchingNotice = { announcement: 'Searching repositories.', visible: 'Searching repositories...' }
const failedNotice = { announcement: 'Repository search failed.', visible: 'Failed to load repositories. Please try again later' }
const noMatchesNotice = { announcement: 'Repository search returned no matches.', visible: 'No repositories match your search' }

export function RepoList({ hasLoadError, hasMore, onLoadMore, onRetry, pendingLoad, replaceCompletion, sortedRepos }: RepoListProps) {
  if (sortedRepos.length > 0) {
    return (
      <div>
        <LoadedContent
          hasMore={hasMore}
          onLoadMore={onLoadMore}
          pendingLoad={pendingLoad}
          replaceCompletion={replaceCompletion}
          repos={sortedRepos}
        />
        {hasLoadError ? (
          <div className="py-8 text-center">
            <p className="text-muted-foreground">{failedNotice.visible}</p>
            <p aria-live="polite" className="sr-only" role="status">
              {failedNotice.announcement}
            </p>
            <div className="mt-3">
              <RetryButton onRetry={onRetry} />
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  // Reaching this branch with a request in flight means the previous result set was already empty, so
  // the standing message here would report a verdict the catalog has not delivered yet.
  const notice = pendingLoad !== null ? searchingNotice : hasLoadError ? failedNotice : noMatchesNotice

  return (
    <div className="py-8 text-center">
      <p className="text-muted-foreground">{notice.visible}</p>
      <p aria-live="polite" className="sr-only" role="status">
        {notice.announcement}
      </p>
      {hasLoadError ? (
        <div className="mt-3">
          <RetryButton onRetry={onRetry} />
        </div>
      ) : null}
    </div>
  )
}
