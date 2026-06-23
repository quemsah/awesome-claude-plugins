'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Repo } from '../../schemas/repo.schema.ts'
import { Button } from '../ui/button.tsx'
import { RepoCard } from './RepoCard.tsx'
import type { SortOption } from './Sort.tsx'

interface InfiniteRepoGridProps {
  items: Repo[]
  sortOption?: SortOption
}

const ITEMS_PER_BATCH = 24

export function InfiniteRepoGrid({ items, sortOption: _sortOption }: InfiniteRepoGridProps) {
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_BATCH)
  const [loadAnnouncement, setLoadAnnouncement] = useState('')
  const observerTarget = useRef<HTMLDivElement>(null)
  const visibleCountRef = useRef(ITEMS_PER_BATCH)

  useEffect(() => {
    visibleCountRef.current = visibleCount
  }, [visibleCount])

  const loadMore = useCallback(() => {
    const previousVisibleCount = visibleCountRef.current
    const nextVisibleCount = Math.min(previousVisibleCount + ITEMS_PER_BATCH, items.length)
    const loadedCount = nextVisibleCount - previousVisibleCount

    if (loadedCount <= 0) return

    visibleCountRef.current = nextVisibleCount
    setVisibleCount(nextVisibleCount)
    setLoadAnnouncement(`${loadedCount} more repositories loaded. ${nextVisibleCount} of ${items.length} repositories are visible.`)
  }, [items.length])

  const handleIntersection = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting) {
        loadMore()
      }
    },
    [loadMore]
  )

  useEffect(() => {
    const observer = new IntersectionObserver(handleIntersection, { threshold: 0.1 })

    if (observerTarget.current) {
      observer.observe(observerTarget.current)
    }

    return () => observer.disconnect()
  }, [handleIntersection])

  useEffect(() => {
    setVisibleCount(ITEMS_PER_BATCH)
  }, [])

  const visibleItems = items.slice(0, visibleCount)

  return (
    <section aria-label="Claude plugins">
      <ul className="m-0 grid list-none grid-cols-1 gap-6 p-0 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visibleItems.map((repo) => (
          <li className="m-0 list-none p-0" key={repo.id}>
            <RepoCard repo={repo} />
          </li>
        ))}
      </ul>

      <p aria-live="polite" className="sr-only" id="load-more-status">
        {loadAnnouncement}
      </p>

      {visibleCount < items.length ? (
        <div className="flex h-20 w-full items-center justify-center" ref={observerTarget}>
          <Button aria-describedby="load-more-status" onClick={loadMore} type="button" variant="outline">
            Load more repositories
          </Button>
        </div>
      ) : null}
    </section>
  )
}
