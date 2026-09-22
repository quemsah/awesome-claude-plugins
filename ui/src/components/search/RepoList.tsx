'use client'

import type { PendingCatalogLoad } from '../../lib/searchState.ts'
import type { Repo } from '../../schemas/repo.schema.ts'
import { RetryButton } from '../repo/RetryButton.tsx'
import { LoadedContent } from './LoadedContent.tsx'

interface RepoListProps {
  failedLoad: PendingCatalogLoad
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

function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="py-8 text-center">
      <p className="text-muted-foreground">{failedNotice.visible}</p>
      <p aria-live="polite" className="sr-only" role="status">
        {failedNotice.announcement}
      </p>
      <div className="mt-3">
        <RetryButton onRetry={onRetry} />
      </div>
    </div>
  )
}

export function RepoList({ failedLoad, hasMore, onLoadMore, onRetry, pendingLoad, replaceCompletion, sortedRepos }: RepoListProps) {
  if (sortedRepos.length > 0) {
    return (
      <div>
        {failedLoad === 'replace' ? <LoadError onRetry={onRetry} /> : null}
        <LoadedContent
          hasMore={failedLoad === 'replace' ? false : hasMore}
          onLoadMore={onLoadMore}
          pendingLoad={pendingLoad}
          replaceCompletion={replaceCompletion}
          repos={sortedRepos}
        />
        {failedLoad === 'append' ? <LoadError onRetry={onRetry} /> : null}
      </div>
    )
  }

  // Reaching this branch with a request in flight means the previous result set was already empty, so
  // the standing message here would report a verdict the catalog has not delivered yet.
  const notice = pendingLoad !== null ? searchingNotice : failedLoad !== null ? failedNotice : noMatchesNotice

  return (
    <div className="py-8 text-center">
      <p className="text-muted-foreground">{notice.visible}</p>
      <p aria-live="polite" className="sr-only" role="status">
        {notice.announcement}
      </p>
      {failedLoad !== null ? (
        <div className="mt-3">
          <RetryButton onRetry={onRetry} />
        </div>
      ) : null}
    </div>
  )
}
