import { describe, expect, it } from 'vitest'
import { formatDate } from './utils.ts'

describe('formatDate', () => {
  it('uses the site en-US locale and UTC calendar date', () => {
    expect(formatDate(new Date('2026-07-31T23:30:00.000Z'))).toBe('Jul 31, 2026')
  })
})
