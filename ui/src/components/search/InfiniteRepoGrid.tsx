'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { PendingCatalogLoad } from '../../lib/searchState.ts'
import { cn } from '../../lib/utils.ts'
import type { Repo } from '../../schemas/repo.schema.ts'
import { RepoCard } from './RepoCard.tsx'
import { RepoCardSkeleton } from './RepoCardSkeleton.tsx'

interface InfiniteRepoGridProps {
  hasMore: boolean
  items: Repo[]
  onLoadMore: () => void
  pendingLoad: PendingCatalogLoad
}

/** How long after a batch lands an intersection edge is still attributable to the layout settling. */
const SETTLE_MS = 400

/** What each in-flight request says while it runs. Only an append adds to what is already on screen. */
const PENDING_LOAD_ANNOUNCEMENTS: Record<Exclude<PendingCatalogLoad, null>, string> = {
  append: 'Loading more repositories.',
  replace: 'Searching repositories.',
}

/** Shown while a search or sort change replaces the list, wherever the list happens to sit. */
const SEARCHING_LABEL = 'Searching repositories...'

/**
 * Two placeholder rows while a request is in flight, for an append and for a replacement alike. The grid
 * gains a column at sm, lg and xl, so a trailing pair stays hidden until the breakpoint that gives it
 * its own column.
 */
const SKELETON_ITEM_CLASSES = [
  '',
  '',
  'hidden sm:block',
  'hidden sm:block',
  'hidden lg:block',
  'hidden lg:block',
  'hidden xl:block',
  'hidden xl:block',
]

export function InfiniteRepoGrid({ hasMore, items, onLoadMore, pendingLoad }: InfiniteRepoGridProps) {
  const isLoading = pendingLoad !== null
  const observerTarget = useRef<HTMLDivElement>(null)
  const previousItemCount = useRef(items.length)
  const itemSignature = `${items.length}:${items[0]?.id ?? ''}:${items[items.length - 1]?.id ?? ''}`
  const previousItemSignature = useRef(itemSignature)
  const [loadStatus, setLoadStatus] = useState('')
  const loadActivityAt = useRef(0)
  // Which operation the in-flight and the just-finished request were. The grid cannot recover that from
  // `items`: a replacement can leave the first card in place and still return a longer page than the set
  // it displaced, so only `SearchPage` knows whether this list grew or started over.
  const inFlightLoad = useRef<PendingCatalogLoad>(null)
  const finishedLoad = useRef<PendingCatalogLoad>(null)
  // Automatic pagination is disarmed for every request and re-armed only after scrolling resumes once
  // the landing layout has settled. This avoids using an absolute scrollY watermark: a replacement can
  // shorten the document so far that the old request-start position is no longer reachable.
  const autoLoadArmed = useRef(true)

  // Read by the observer instead of closing over it: a fresh IntersectionObserver reports the target's
  // current state immediately, so an observer recreated whenever `isLoading` toggled answered "still on
  // screen" the moment a landing page unmounted its placeholders and started the next load by itself.
  const loadMoreState = useRef({ hasMore, isLoading, onLoadMore })
  useEffect(() => {
    loadMoreState.current = { hasMore, isLoading, onLoadMore }
    if (!isLoading) {
      finishedLoad.current = inFlightLoad.current
      inFlightLoad.current = null
      return
    }

    inFlightLoad.current = pendingLoad
    autoLoadArmed.current = false
    loadActivityAt.current = Date.now()
    // The completion line from the previous request has to leave the live region before the next one
    // lands: the frame between a response arriving and the count being recomputed would otherwise
    // announce the old "Loaded N more" under a list that has just been replaced.
    setLoadStatus('')
  }, [hasMore, isLoading, onLoadMore, pendingLoad])

  useEffect(() => {
    let pendingRearm: number | null = null

    const loadIfTargetIsVisible = () => {
      const state = loadMoreState.current
      const target = observerTarget.current
      if (state.isLoading || !state.hasMore || !target) return

      const rect = target.getBoundingClientRect()
      if (rect.top >= window.innerHeight || rect.bottom <= 0) return

      // Disarm before calling out for the same reason as the observer callback below: React has not
      // necessarily published the new pending-load state by the time another callback can run.
      autoLoadArmed.current = false
      state.onLoadMore()
    }

    const rearmAutoLoad = () => {
      const state = loadMoreState.current
      if (state.isLoading) return

      const elapsed = Date.now() - loadActivityAt.current
      if (elapsed < SETTLE_MS) {
        // A real user scroll during the settle window is intent, not layout movement. Defer that scroll
        // until the window closes instead of dropping it; pure IntersectionObserver edges still stay
        // suppressed because they do not schedule this timer.
        if (pendingRearm !== null) window.clearTimeout(pendingRearm)
        pendingRearm = window.setTimeout(() => {
          pendingRearm = null
          if (loadMoreState.current.isLoading) return
          autoLoadArmed.current = true
          loadIfTargetIsVisible()
        }, SETTLE_MS - elapsed)
        return
      }

      autoLoadArmed.current = true
      loadIfTargetIsVisible()
    }

    window.addEventListener('scroll', rearmAutoLoad, { passive: true })
    return () => {
      window.removeEventListener('scroll', rearmAutoLoad)
      if (pendingRearm !== null) window.clearTimeout(pendingRearm)
    }
  }, [])

  useEffect(() => {
    if (!hasMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        const state = loadMoreState.current
        // A request starting or landing rearranges the grid under the trigger and the browser can carry
        // the viewport onto it in the same beat, which is indistinguishable from the visitor arriving at
        // the end. An edge that soon is the layout moving, not the visitor: the next one, or the "Load
        // more" button, is what starts another page.
        if (Date.now() - loadActivityAt.current < SETTLE_MS) return

        // A layout-only move must not re-arm pagination. Once a request starts, a later intersection is
        // ignored until scrolling resumes after the landing settles. Unlike comparing against the
        // request-start scrollY, this still works when a replacement shortens the document below that
        // old position.
        if (!autoLoadArmed.current) return

        if (entries[0]?.isIntersecting && state.hasMore && !state.isLoading) {
          // Disarm synchronously so repeated observer callbacks cannot start parallel pages before
          // SearchPage publishes the new pending-load state.
          autoLoadArmed.current = false
          state.onLoadMore()
        }
      },
      { threshold: 0.1 }
    )

    if (observerTarget.current) {
      observer.observe(observerTarget.current)
    }

    return () => observer.disconnect()
  }, [hasMore])

  useEffect(() => {
    if (itemSignature === previousItemSignature.current) return

    const appendedCount = items.length - previousItemCount.current
    // "More" only fits a list that kept what it was showing, and only `SearchPage` knows that: a
    // replacement can land a longer first page than the set it displaced. A search's totals are
    // announced by the controls above the grid, so a replacement leaves this region empty.
    setLoadStatus(finishedLoad.current === 'append' && appendedCount > 0 ? `Loaded ${appendedCount} more repositories.` : '')
    finishedLoad.current = null
    previousItemCount.current = items.length
    previousItemSignature.current = itemSignature
    loadActivityAt.current = Date.now()
  }, [itemSignature, items.length])

  return (
    <section aria-label="Claude plugins" id="repo-results">
      <ul className="m-0 grid list-none grid-cols-1 gap-6 p-0 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((repo) => (
          <li className="m-0 list-none p-0" key={repo.id}>
            <RepoCard repo={repo} />
          </li>
        ))}
        {isLoading
          ? SKELETON_ITEM_CLASSES.map((className, index) => (
              // `overflow-anchor: none`: these rows sit at the bottom of the viewport while the request
              // is in flight, and Chrome keeps its scroll anchor still when it disappears. Anchoring to
              // a placeholder therefore scrolled the page down onto the trigger and started the next
              // load.
              <li aria-hidden="true" className={cn('m-0 list-none p-0 [overflow-anchor:none]', className)} key={index}>
                <RepoCardSkeleton />
              </li>
            ))
          : null}
      </ul>

      {/* The footer below doubles as the pagination trigger, so a list that is already complete has no
          footer at all: without this line a replacement of it would be visible only to a screen reader. */}
      {pendingLoad === 'replace' && hasMore === false && (
        <p className="py-8 text-center text-muted-foreground text-sm">{SEARCHING_LABEL}</p>
      )}

      {hasMore === true && (
        // The trigger is also kept out of anchor selection: while a page is in flight this row sits at
        // the bottom of the viewport, and an anchor here would be held still by scrolling down onto it.
        <div
          className="flex w-full flex-col items-center justify-center gap-2 py-8 text-muted-foreground text-sm [overflow-anchor:none]"
          ref={observerTarget}
        >
          {/* `invisible` rather than dropping the node: the row keeps its 28px, and a document that
              changes height between loading and idle is a document whose saved scroll offsets clamp.
              An append hides the text because its placeholder rows already say what is happening. */}
          <span className={pendingLoad === 'append' ? 'invisible' : undefined}>
            {pendingLoad === 'replace' ? SEARCHING_LABEL : 'More repositories available'}
          </span>
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
        {pendingLoad ? PENDING_LOAD_ANNOUNCEMENTS[pendingLoad] : loadStatus || null}
      </p>
    </section>
  )
}
