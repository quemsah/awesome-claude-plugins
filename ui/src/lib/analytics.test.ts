/** biome-ignore-all lint/style/useNamingConvention: Simple Analytics global is sa_event */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  flushPendingEvents,
  isAnalyticsActive,
  isPrivacyRestricted,
  shouldLoadAnalytics,
  trackCopyMarketplaceAdd,
  trackCopyPluginInstall,
  trackEvent,
  trackFilterChange,
  trackOpenGithub,
  trackSearchNoResults,
  trackSortChange,
} from './analytics.ts'

describe('analytics', () => {
  const originalNavigator = globalThis.navigator
  const originalWindow = globalThis.window

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    })
  })

  describe('shouldLoadAnalytics', () => {
    it('only enables analytics in the Railway production environment', () => {
      expect(shouldLoadAnalytics('production')).toBe(true)
      expect(shouldLoadAnalytics('staging')).toBe(false)
      expect(shouldLoadAnalytics(undefined)).toBe(false)
    })
  })

  describe('isPrivacyRestricted', () => {
    it('returns false when no privacy signals are active', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: { globalPrivacyControl: false, doNotTrack: '0' },
        configurable: true,
        writable: true,
      })
      Object.defineProperty(globalThis, 'window', {
        value: { doNotTrack: undefined },
        configurable: true,
        writable: true,
      })
      expect(isPrivacyRestricted()).toBe(false)
    })

    it('returns true when globalPrivacyControl is true', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: { globalPrivacyControl: true },
        configurable: true,
        writable: true,
      })
      expect(isPrivacyRestricted()).toBe(true)
    })

    it('returns true when navigator.doNotTrack is "1"', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: { doNotTrack: '1' },
        configurable: true,
        writable: true,
      })
      expect(isPrivacyRestricted()).toBe(true)
    })

    it('returns true when navigator.doNotTrack is "yes"', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: { doNotTrack: 'yes' },
        configurable: true,
        writable: true,
      })
      expect(isPrivacyRestricted()).toBe(true)
    })

    it('returns true when window.doNotTrack is "1"', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {},
        configurable: true,
        writable: true,
      })
      Object.defineProperty(globalThis, 'window', {
        value: { doNotTrack: '1' },
        configurable: true,
        writable: true,
      })
      expect(isPrivacyRestricted()).toBe(true)
    })
  })

  describe('isAnalyticsActive', () => {
    it('returns false when window.sa_event is not available', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {},
        configurable: true,
        writable: true,
      })
      Object.defineProperty(globalThis, 'window', {
        value: {},
        configurable: true,
        writable: true,
      })
      expect(isAnalyticsActive()).toBe(false)
    })

    it('returns false when privacy is restricted despite sa_event being defined', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: { globalPrivacyControl: true },
        configurable: true,
        writable: true,
      })
      Object.defineProperty(globalThis, 'window', {
        value: { sa_event: vi.fn() },
        configurable: true,
        writable: true,
      })
      expect(isAnalyticsActive()).toBe(false)
    })

    it('returns true when sa_event is defined and privacy is not restricted', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: { globalPrivacyControl: false, doNotTrack: '0' },
        configurable: true,
        writable: true,
      })
      Object.defineProperty(globalThis, 'window', {
        value: { sa_event: vi.fn() },
        configurable: true,
        writable: true,
      })
      expect(isAnalyticsActive()).toBe(true)
    })
  })

  describe('trackEvent', () => {
    it('safely returns false when analytics is not active', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {},
        configurable: true,
        writable: true,
      })
      Object.defineProperty(globalThis, 'window', {
        value: {},
        configurable: true,
        writable: true,
      })
      expect(trackEvent('copy_marketplace_add')).toBe(false)
    })

    it('does not send events when GPC or DNT is active', () => {
      const saEventMock = vi.fn()
      Object.defineProperty(globalThis, 'navigator', {
        value: { globalPrivacyControl: true },
        configurable: true,
        writable: true,
      })
      Object.defineProperty(globalThis, 'window', {
        value: { sa_event: saEventMock },
        configurable: true,
        writable: true,
      })

      expect(trackEvent('copy_plugin_install')).toBe(false)
      expect(saEventMock).not.toHaveBeenCalled()
    })

    it('calls sa_event without metadata when omitted', () => {
      const saEventMock = vi.fn()
      Object.defineProperty(globalThis, 'navigator', {
        value: { globalPrivacyControl: false },
        configurable: true,
        writable: true,
      })
      Object.defineProperty(globalThis, 'window', {
        value: { sa_event: saEventMock },
        configurable: true,
        writable: true,
      })

      expect(trackEvent('open_github')).toBe(true)
      expect(saEventMock).toHaveBeenCalledWith('open_github')
    })

    it('calls sa_event with metadata when provided', () => {
      const saEventMock = vi.fn()
      Object.defineProperty(globalThis, 'navigator', {
        value: { globalPrivacyControl: false },
        configurable: true,
        writable: true,
      })
      Object.defineProperty(globalThis, 'window', {
        value: { sa_event: saEventMock },
        configurable: true,
        writable: true,
      })

      expect(trackEvent('sort_change', { sort: 'stars-desc' })).toBe(true)
      expect(saEventMock).toHaveBeenCalledWith('sort_change', { sort: 'stars-desc' })
    })

    it('buffers an early event until the analytics script is ready', () => {
      Object.defineProperty(globalThis, 'navigator', { value: { doNotTrack: '0' }, configurable: true })
      Object.defineProperty(globalThis, 'window', { value: {}, configurable: true })
      expect(trackEvent('copy_plugin_install')).toBe(false)

      const saEvent = vi.fn()
      Object.defineProperty(globalThis, 'window', { value: { sa_event: saEvent }, configurable: true })
      flushPendingEvents()
      expect(saEvent).toHaveBeenCalledWith('copy_plugin_install', undefined)
    })

    it('does not send events when window DNT is enabled independently', () => {
      const saEvent = vi.fn()
      Object.defineProperty(globalThis, 'navigator', { value: { doNotTrack: '0' }, configurable: true })
      Object.defineProperty(globalThis, 'window', { value: { doNotTrack: '1', sa_event: saEvent }, configurable: true })
      expect(isPrivacyRestricted()).toBe(true)
      expect(trackEvent('copy_marketplace_add')).toBe(false)
      flushPendingEvents()
      expect(saEvent).not.toHaveBeenCalled()
    })
    it('handles sa_event throwing an error without crashing', () => {
      const saEventMock = vi.fn().mockImplementation(() => {
        throw new Error('Script error')
      })
      Object.defineProperty(globalThis, 'navigator', {
        value: { globalPrivacyControl: false },
        configurable: true,
        writable: true,
      })
      Object.defineProperty(globalThis, 'window', {
        value: { sa_event: saEventMock },
        configurable: true,
        writable: true,
      })

      expect(trackEvent('search_no_results')).toBe(false)
    })

    it('convenience helper functions work as expected', () => {
      const saEventMock = vi.fn()
      Object.defineProperty(globalThis, 'navigator', {
        value: { globalPrivacyControl: false },
        configurable: true,
        writable: true,
      })
      Object.defineProperty(globalThis, 'window', {
        value: { sa_event: saEventMock },
        configurable: true,
        writable: true,
      })

      expect(trackCopyMarketplaceAdd()).toBe(true)
      expect(saEventMock).toHaveBeenCalledWith('copy_marketplace_add')

      expect(trackCopyPluginInstall()).toBe(true)
      expect(saEventMock).toHaveBeenCalledWith('copy_plugin_install')

      expect(trackOpenGithub()).toBe(true)
      expect(saEventMock).toHaveBeenCalledWith('open_github')

      expect(trackSearchNoResults()).toBe(true)
      expect(saEventMock).toHaveBeenCalledWith('search_no_results')

      expect(trackSortChange('forks-desc')).toBe(true)
      expect(saEventMock).toHaveBeenCalledWith('sort_change', { sort: 'forks-desc' })

      expect(trackFilterChange('30days')).toBe(true)
      expect(saEventMock).toHaveBeenCalledWith('filter_change', { filter: '30days' })
    })
  })
})
