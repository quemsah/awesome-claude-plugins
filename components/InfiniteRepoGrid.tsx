import { useEffect, useRef, useState } from 'react'
import type { Repo } from '../app/types/repo.type.ts'
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

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + ITEMS_PER_BATCH, items.length))
        }
      },
      { threshold: 0.1 }
    )

    if (observerTarget.current) {
      observer.observe(observerTarget.current)
    }

    return () => observer.disconnect()
  }, [items.length])

  useEffect(() => {
    setVisibleCount(ITEMS_PER_BATCH)
  }, [])

  const visibleItems = items.slice(0, visibleCount)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visibleItems.map((repo) => (
          <RepoCard key={repo.id} repo={repo} />
        ))}
      </div>

      {/* Sentinel element for infinite scroll */}
      {visibleCount < items.length && (
        <div ref={observerTarget} className="h-20 w-full flex items-center justify-center text-muted-foreground text-sm">
          Loading more repositories...
        </div>
      )}
    </div>
  )
}
