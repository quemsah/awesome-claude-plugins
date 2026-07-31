'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Repo } from '../../schemas/repo.schema.ts'
import { RepoCard } from './RepoCard.tsx'

interface InfiniteRepoGridProps {
  hasMore: boolean
  isLoading: boolean
  items: Repo[]
  onLoadMore: () => void
}

export function InfiniteRepoGrid({ hasMore, isLoading, items, onLoadMore }: InfiniteRepoGridProps) {
  const observerTarget = useRef<HTMLDivElement>(null)
  const previousItemCount = useRef(items.length)
  const itemSignature = `${items.length}:${items[0]?.id ?? ''}:${items[items.length - 1]?.id ?? ''}`
  const previousItemSignature = useRef(itemSignature)
  const [loadStatus, setLoadStatus] = useState('')

  const handleIntersection = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0]?.isIntersecting && hasMore && !isLoading) {
        onLoadMore()
      }
    },
    [hasMore, isLoading, onLoadMore]
  )

  useEffect(() => {
    const observer = new IntersectionObserver(handleIntersection, { threshold: 0.1 })

    if (observerTarget.current) {
      observer.observe(observerTarget.current)
    }

    return () => observer.disconnect()
  }, [handleIntersection])

  useEffect(() => {
    if (itemSignature === previousItemSignature.current) return

    const loadedCount = items.length - previousItemCount.current
    setLoadStatus(loadedCount > 0 ? `Loaded ${loadedCount} more repositories.` : '')
    previousItemCount.current = items.length
    previousItemSignature.current = itemSignature
  }, [itemSignature, items.length])

  return (
    <section aria-label="Claude plugins" id="repo-results">
      <ul className="m-0 grid list-none grid-cols-1 gap-6 p-0 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((repo) => (
          <li className="m-0 list-none p-0" key={repo.id}>
            <RepoCard repo={repo} />
          </li>
        ))}
      </ul>

      {hasMore === true && (
        <div className="flex w-full flex-col items-center justify-center gap-2 py-8 text-muted-foreground text-sm" ref={observerTarget}>
          <span>{isLoading ? 'Loading more repositories...' : 'More repositories available'}</span>
          <button
            className="rounded-md border px-4 py-2 font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isLoading}
            onClick={onLoadMore}
            type="button"
          >
            Load more
          </button>
          <Link className="underline-offset-4 hover:text-foreground hover:underline" href="/browse/2">
            Browse catalog pages
          </Link>
        </div>
      )}
      <p aria-atomic="true" aria-live="polite" className="sr-only" role="status">
        {isLoading ? 'Loading more repositories.' : loadStatus || null}
      </p>
    </section>
  )
}
