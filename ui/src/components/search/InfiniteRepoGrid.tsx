'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getExpandedVisibleCount, getRenderedItemCount, getResetVisibleCount } from '../../lib/visibleResults.ts'
import type { Repo } from '../../schemas/repo.schema.ts'
import { RepoCard } from './RepoCard.tsx'

interface InfiniteRepoGridProps {
  items: Repo[]
}

export function InfiniteRepoGrid({ items }: InfiniteRepoGridProps) {
  const [visibleCount, setVisibleCount] = useState(() => getResetVisibleCount())
  const observerTarget = useRef<HTMLDivElement>(null)

  const handleIntersection = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting) {
        setVisibleCount((prev) => getExpandedVisibleCount(prev, items.length))
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

  const renderedItemCount = getRenderedItemCount(visibleCount, items.length)
  const visibleItems = items.slice(0, renderedItemCount)

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
