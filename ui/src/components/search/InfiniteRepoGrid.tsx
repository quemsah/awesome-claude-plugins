'use client'

import { useCallback, useEffect, useRef } from 'react'
import type { Repo } from '../../schemas/repo.schema.ts'
import { Button } from '../ui/button.tsx'
import { RepoCard } from './RepoCard.tsx'

interface InfiniteRepoGridProps {
  hasMore: boolean
  isLoadingMore: boolean
  items: Repo[]
  onLoadMore: () => void
}

export function InfiniteRepoGrid({ hasMore, isLoadingMore, items, onLoadMore }: InfiniteRepoGridProps) {
  const observerTarget = useRef<HTMLDivElement>(null)

  const handleIntersection = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
        onLoadMore()
      }
    },
    [hasMore, isLoadingMore, onLoadMore]
  )

  useEffect(() => {
    const observer = new IntersectionObserver(handleIntersection, { threshold: 0.1 })

    if (observerTarget.current) {
      observer.observe(observerTarget.current)
    }

    return () => observer.disconnect()
  }, [handleIntersection])

  return (
    <section aria-label="Claude plugins">
      <ul className="m-0 grid list-none grid-cols-1 gap-6 p-0 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((repo) => (
          <li className="m-0 list-none p-0" key={repo.id}>
            <RepoCard repo={repo} />
          </li>
        ))}
      </ul>

      {hasMore ? (
        <div className="flex h-24 w-full items-center justify-center" ref={observerTarget}>
          <Button disabled={isLoadingMore} onClick={onLoadMore} type="button" variant="outline">
            {isLoadingMore ? 'Loading repositories...' : 'Load more repositories'}
          </Button>
        </div>
      ) : null}
    </section>
  )
}
