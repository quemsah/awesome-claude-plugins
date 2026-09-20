import { describe, expect, it } from 'vitest'
import { MAX_QUERY_LENGTH, normalizeSearchQuery } from './searchQuery.ts'

describe('normalizeSearchQuery', () => {
  it('lowercases and trims for case-insensitive surfaces', () => {
    expect(normalizeSearchQuery('  Claude-Plugin  ')).toBe('claude-plugin')
  })

  it('caps the pattern at the fuse bitap limit', () => {
    expect(normalizeSearchQuery('x'.repeat(MAX_QUERY_LENGTH + 8))).toHaveLength(MAX_QUERY_LENGTH)
  })

  it('counts the cap against the trimmed query so padding cannot drop search terms', () => {
    expect(normalizeSearchQuery('   claude-plugins-for-production-deployments')).toBe('claude-plugins-for-production-de')
  })

  it('is idempotent so applying it twice cannot change the search', () => {
    for (const query of ['  Claude-Plugin ', 'x'.repeat(MAX_QUERY_LENGTH + 8), '', '   ']) {
      expect(normalizeSearchQuery(normalizeSearchQuery(query))).toBe(normalizeSearchQuery(query))
    }
  })

  it('collapses whitespace-only input to no search', () => {
    expect(normalizeSearchQuery('   ')).toBe('')
  })
})
