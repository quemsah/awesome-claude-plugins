'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Repo } from '../../schemas/repo.schema.ts'
import { RepoCard } from './RepoCard.tsx'
import type { SortOption } from './Sort.tsx'

interface InfiniteRepoGridProps {
  items: Repo[]
  sortOption?: SortOption
}

const ITEMS_PER_BATCH = 24

export function InfiniteRepoGrid({ items, sortOption: _sortOption }: InfiniteRepoGridProps) {
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_BATCH)
  const observerTarget = useRef<HTMLDivElement>(null)

  const handleIntersection = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting) {
        setVisibleCount((prev) => Math.min(prev + ITEMS_PER_BATCH, items.length))
      }
    },
    [items.length]
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

      {visibleCount < items.length && (
        <div className="flex h-20 w-full items-center justify-center text-muted-foreground text-sm" ref={observerTarget}>
          Loading more repositories...
        </div>
      )}
    </section>
  )
}
