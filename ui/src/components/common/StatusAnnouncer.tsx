'use client'

import { useSyncExternalStore } from 'react'
import { getStatusAnnouncement, getStatusMessage, type StatusPriority, subscribeToStatus } from '../../lib/statusAnnouncer.ts'

const INITIAL_MESSAGE = { parity: false, text: '' }

function AnnouncedStatus({ priority }: { priority: StatusPriority }) {
  const message = useSyncExternalStore(
    subscribeToStatus,
    () => getStatusMessage(priority),
    () => INITIAL_MESSAGE
  )

  return (
    <span
      aria-atomic="true"
      aria-live={priority}
      className="sr-only"
      id={`status-${priority}`}
      role={priority === 'assertive' ? 'alert' : 'status'}
    >
      {getStatusAnnouncement(message)}
    </span>
  )
}

/**
 * One polite and one assertive region for the whole document. Components report to them through
 * `announceStatus` instead of carrying a private region each, which is what keeps a catalog grid of any
 * size down to a fixed pair: a region added to the DOM after a screen reader started tracking is not
 * reliably announced, and the grid appends cards long after that.
 */
export function StatusAnnouncer() {
  return (
    <>
      <AnnouncedStatus priority="polite" />
      <AnnouncedStatus priority="assertive" />
    </>
  )
}
