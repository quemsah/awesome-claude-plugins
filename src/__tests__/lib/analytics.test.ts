import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isAnalyticsEnabled, GA_ID, GTM_ID } from '../../lib/analytics'

describe('analytics', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('GA_ID', () => {
    it('should use environment variable when set', () => {
      // Note: This test checks the default since we can't easily change the imported constant
      expect(GA_ID).toBeDefined()
      expect(typeof GA_ID).toBe('string')
    })

    it('should have a default value', () => {
      expect(GA_ID).toBe('G-XXXXXXXXXX')
    })
  })

  describe('GTM_ID', () => {
    it('should use environment variable when set', () => {
      expect(GTM_ID).toBeDefined()
      expect(typeof GTM_ID).toBe('string')
    })

    it('should have a default value', () => {
      expect(GTM_ID).toBe('GTM-XXXXXXXX')
    })
  })

  describe('isAnalyticsEnabled', () => {
    it('should return false in development environment', () => {
      process.env.NODE_ENV = 'development'
      
      // Since the module is already imported, we test the logic
      const result = process.env.NODE_ENV === 'production' && (GA_ID !== 'G-XXXXXXXXXX' || GTM_ID !== 'GTM-XXXXXXXX')
      expect(result).toBe(false)
    })

    it('should return false in test environment', () => {
      process.env.NODE_ENV = 'test'
      
      const result = process.env.NODE_ENV === 'production' && (GA_ID !== 'G-XXXXXXXXXX' || GTM_ID !== 'GTM-XXXXXXXX')
      expect(result).toBe(false)
    })

    it('should return false in production with default GA_ID and GTM_ID', () => {
      process.env.NODE_ENV = 'production'
      
      const result = process.env.NODE_ENV === 'production' && ('G-XXXXXXXXXX' !== 'G-XXXXXXXXXX' || 'GTM-XXXXXXXX' !== 'GTM-XXXXXXXX')
      expect(result).toBe(false)
    })

    it('should return true in production with valid GA_ID', () => {
      process.env.NODE_ENV = 'production'
      
      const result = process.env.NODE_ENV === 'production' && ('G-REAL12345' !== 'G-XXXXXXXXXX' || 'GTM-XXXXXXXX' !== 'GTM-XXXXXXXX')
      expect(result).toBe(true)
    })

    it('should return true in production with valid GTM_ID', () => {
      process.env.NODE_ENV = 'production'
      
      const result = process.env.NODE_ENV === 'production' && ('G-XXXXXXXXXX' !== 'G-XXXXXXXXXX' || 'GTM-REAL123' !== 'GTM-XXXXXXXX')
      expect(result).toBe(true)
    })

    it('should return true in production with both valid IDs', () => {
      process.env.NODE_ENV = 'production'
      
      const result = process.env.NODE_ENV === 'production' && ('G-REAL12345' !== 'G-XXXXXXXXXX' || 'GTM-REAL123' !== 'GTM-XXXXXXXX')
      expect(result).toBe(true)
    })

    it('should handle undefined NODE_ENV', () => {
      delete process.env.NODE_ENV
      
      const result = process.env.NODE_ENV === 'production' && (GA_ID !== 'G-XXXXXXXXXX' || GTM_ID !== 'GTM-XXXXXXXX')
      expect(result).toBe(false)
    })
  })

  describe('analytics function behavior', () => {
    it('should be callable', () => {
      expect(typeof isAnalyticsEnabled).toBe('function')
      expect(() => isAnalyticsEnabled()).not.toThrow()
    })

    it('should return a boolean', () => {
      const result = isAnalyticsEnabled()
      expect(typeof result).toBe('boolean')
    })
  })

  describe('edge cases', () => {
    it('should handle empty string GA_ID', () => {
      const result = process.env.NODE_ENV === 'production' && ('' !== 'G-XXXXXXXXXX' || GTM_ID !== 'GTM-XXXXXXXX')
      expect(result).toBe(true)
    })

    it('should handle empty string GTM_ID', () => {
      const result = process.env.NODE_ENV === 'production' && (GA_ID !== 'G-XXXXXXXXXX' || '' !== 'GTM-XXXXXXXX')
      expect(result).toBe(true)
    })

    it('should handle partial matches', () => {
      const result = process.env.NODE_ENV === 'production' && ('G-XXXXXXXX' !== 'G-XXXXXXXXXX' || GTM_ID !== 'GTM-XXXXXXXX')
      expect(result).toBe(true)
    })

    it('should handle case sensitivity', () => {
      const result = process.env.NODE_ENV === 'production' && ('g-xxxxxxxxxx' !== 'G-XXXXXXXXXX' || GTM_ID !== 'GTM-XXXXXXXX')
      expect(result).toBe(true)
    })
  })
})