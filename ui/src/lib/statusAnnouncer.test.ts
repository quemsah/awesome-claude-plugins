import { afterEach, describe, expect, it, vi } from 'vitest'
import { announceStatus, getStatusAnnouncement, getStatusMessage, subscribeToStatus } from './statusAnnouncer.ts'

describe('statusAnnouncer', () => {
  afterEach(() => {
    announceStatus('', 'polite')
    announceStatus('', 'assertive')
  })

  it('keeps the two priorities apart', () => {
    announceStatus('Marketplace command copied', 'polite')
    announceStatus('Unable to copy the command.', 'assertive')

    expect(getStatusMessage('polite').text).toBe('Marketplace command copied')
    expect(getStatusMessage('assertive').text).toBe('Unable to copy the command.')
  })

  it('returns a stable snapshot until the next announcement', () => {
    // `useSyncExternalStore` re-renders forever if the snapshot is a fresh object each read.
    const first = getStatusMessage('polite')
    expect(getStatusMessage('polite')).toBe(first)

    announceStatus('Repository search returned no matches.')
    expect(getStatusMessage('polite')).not.toBe(first)
  })

  it('makes a repeated message a text change so it announces again', () => {
    announceStatus('Marketplace command copied')
    const once = getStatusAnnouncement(getStatusMessage('polite'))
    announceStatus('Marketplace command copied')
    const twice = getStatusAnnouncement(getStatusMessage('polite'))

    expect(once).not.toBe(twice)
    // The marker carries no visible glyph, so both read as the same sentence to a user.
    expect(twice.replace('\u200B', '')).toBe(once.replace('\u200B', ''))
  })

  it('renders nothing while no message has been announced', () => {
    expect(getStatusAnnouncement(getStatusMessage('assertive'))).toBe('')
  })

  it('notifies subscribers and stops after unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToStatus(listener)

    announceStatus('Loaded 24 more repositories.')
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    announceStatus('Loaded 24 more repositories.')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
