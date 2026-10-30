import { describe, expect, it } from 'vitest'
import { formatDate, formatRelativeTime } from './utils.ts'

describe('formatDate', () => {
  it('uses the site en-US locale and UTC calendar date', () => {
    expect(formatDate(new Date('2026-07-31T23:30:00.000Z'))).toBe('Jul 31, 2026')
  })
})

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-10-30T00:00:00.000Z')
  it('never displays 0 years at the month-to-year boundary', () => {
    expect(formatRelativeTime(now - 364 * 86_400_000, now)).toBe('12 months ago')
    expect(formatRelativeTime(now - 365 * 86_400_000, now)).toBe('1 year ago')
  })
  it('handles unknown dates', () => {
    expect(formatRelativeTime(null, now)).toBeNull()
    expect(formatRelativeTime('not-a-date', now)).toBeNull()
  })
})
