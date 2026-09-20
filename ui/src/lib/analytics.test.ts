import { describe, expect, it } from 'vitest'
import { shouldLoadAnalytics } from './analytics.ts'

describe('shouldLoadAnalytics', () => {
  it('only enables analytics in the Railway production environment', () => {
    expect(shouldLoadAnalytics('production')).toBe(true)
    expect(shouldLoadAnalytics('staging')).toBe(false)
    expect(shouldLoadAnalytics(undefined)).toBe(false)
  })
})
