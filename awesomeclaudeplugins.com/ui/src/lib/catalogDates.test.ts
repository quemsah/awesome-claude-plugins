import { describe, expect, it } from 'vitest'
import { FALLBACK_LAST_MODIFIED, getLatestValidStatsDate } from './catalogDates.ts'

describe('getLatestValidStatsDate', () => {
  it('returns the latest valid date even when snapshots are unsorted', () => {
    const result = getLatestValidStatsDate([
      { date: '2026-01-02T00:00:00.000Z', size: 2, id: 2 },
      { date: '2026-02-02T00:00:00.000Z', size: 3, id: 3 },
      { date: '2026-01-15T00:00:00.000Z', size: 1, id: 1 },
    ])

    expect(result.toISOString()).toBe('2026-02-02T00:00:00.000Z')
  })

  it('ignores invalid entries and falls back when no valid dates exist', () => {
    expect(getLatestValidStatsDate([{ date: 'not-a-date', size: 1, id: 1 }])).toEqual(FALLBACK_LAST_MODIFIED)
    expect(getLatestValidStatsDate([])).toEqual(FALLBACK_LAST_MODIFIED)
  })
})
