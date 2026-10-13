import { describe, expect, it } from 'vitest'
import { formatDate, formatRelativeTime } from './utils.ts'

describe('formatDate', () => {
  it('uses the site en-US locale and UTC calendar date', () => {
    expect(formatDate(new Date('2026-07-31T23:30:00.000Z'))).toBe('Jul 31, 2026')
  })
})

describe('formatRelativeTime', () => {
  const now = new Date('2026-10-13T12:00:00.000Z').getTime()

  it('handles null and undefined gracefully', () => {
    expect(formatRelativeTime(null, now)).toBeNull()
    expect(formatRelativeTime(undefined, now)).toBeNull()
    expect(formatRelativeTime('invalid-date', now)).toBeNull()
  })

  it('formats recent events', () => {
    expect(formatRelativeTime(new Date(now - 30 * 1000), now)).toBe('just now')
    expect(formatRelativeTime(new Date(now - 15 * 60 * 1000), now)).toBe('15m ago')
    expect(formatRelativeTime(new Date(now - 3 * 3600 * 1000), now)).toBe('3h ago')
  })

  it('formats days and months', () => {
    expect(formatRelativeTime(new Date(now - 24 * 3600 * 1000), now)).toBe('yesterday')
    expect(formatRelativeTime(new Date(now - 3 * 24 * 3600 * 1000), now)).toBe('3 days ago')
    expect(formatRelativeTime(new Date(now - 35 * 24 * 3600 * 1000), now)).toBe('1 month ago')
    expect(formatRelativeTime(new Date(now - 90 * 24 * 3600 * 1000), now)).toBe('3 months ago')
  })

  it('formats years', () => {
    expect(formatRelativeTime(new Date(now - 370 * 24 * 3600 * 1000), now)).toBe('1 year ago')
    expect(formatRelativeTime(new Date(now - 750 * 24 * 3600 * 1000), now)).toBe('2 years ago')
  })
})
