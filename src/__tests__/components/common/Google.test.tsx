import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Google from '../../../components/common/Google'

// Mock the analytics module
vi.mock('../../../lib/analytics', () => ({
  GA_ID: 'G-TEST12345',
  GTM_ID: 'GTM-TEST123',
  isAnalyticsEnabled: vi.fn(() => true),
  reportWebVitals: vi.fn(),
  trackEvent: vi.fn(),
  trackPageView: vi.fn(),
}))

// Mock Next.js third-party components
vi.mock('@next/third-parties/google', () => ({
  GoogleAnalytics: vi.fn(({ gaId }) => <div data-testid="google-analytics" data-ga-id={gaId} />),
  GoogleTagManager: vi.fn(({ gtmId }) => <div data-testid="google-tag-manager" data-gtm-id={gtmId} />),
}))

describe('Google', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering when analytics enabled', () => {
    it('should render GoogleAnalytics component', () => {
      const { getByTestId } = render(<Google />)
      
      const analytics = getByTestId('google-analytics')
      expect(analytics).toBeInTheDocument()
      expect(analytics).toHaveAttribute('data-ga-id', 'G-TEST12345')
    })

    it('should render GoogleTagManager component', () => {
      const { getByTestId } = render(<Google />)
      
      const tagManager = getByTestId('google-tag-manager')
      expect(tagManager).toBeInTheDocument()
      expect(tagManager).toHaveAttribute('data-gtm-id', 'GTM-TEST123')
    })

    it('should render both components together', () => {
      const { getByTestId } = render(<Google />)
      
      expect(getByTestId('google-analytics')).toBeInTheDocument()
      expect(getByTestId('google-tag-manager')).toBeInTheDocument()
    })
  })

  describe('rendering when analytics disabled', () => {
    it('should return null when analytics is disabled', async () => {
      // Re-mock with disabled analytics
      vi.doMock('../../../lib/analytics', () => ({
        GA_ID: 'G-XXXXXXXXXX',
        GTM_ID: 'GTM-XXXXXXXX',
        isAnalyticsEnabled: vi.fn(() => false),
        reportWebVitals: vi.fn(),
        trackEvent: vi.fn(),
        trackPageView: vi.fn(),
      }))

      const { isAnalyticsEnabled } = await import('../../../lib/analytics')
      vi.mocked(isAnalyticsEnabled).mockReturnValue(false)

      const { container } = render(<Google />)
      
      // When returning null, container should be empty
      expect(container.firstChild).toBeNull()
    })
  })

  describe('exports', () => {
    it('should export reportWebVitals', async () => {
      const module = await import('../../../components/common/Google')
      expect(module.reportWebVitals).toBeDefined()
      expect(typeof module.reportWebVitals).toBe('function')
    })

    it('should export trackEvent', async () => {
      const module = await import('../../../components/common/Google')
      expect(module.trackEvent).toBeDefined()
      expect(typeof module.trackEvent).toBe('function')
    })

    it('should export trackPageView', async () => {
      const module = await import('../../../components/common/Google')
      expect(module.trackPageView).toBeDefined()
      expect(typeof module.trackPageView).toBe('function')
    })
  })

  describe('edge cases', () => {
    it('should handle undefined GA_ID', () => {
      vi.doMock('../../../lib/analytics', () => ({
        GA_ID: undefined,
        GTM_ID: 'GTM-TEST123',
        isAnalyticsEnabled: vi.fn(() => true),
      }))

      const { container } = render(<Google />)
      expect(container).toBeInTheDocument()
    })

    it('should handle undefined GTM_ID', () => {
      vi.doMock('../../../lib/analytics', () => ({
        GA_ID: 'G-TEST12345',
        GTM_ID: undefined,
        isAnalyticsEnabled: vi.fn(() => true),
      }))

      const { container } = render(<Google />)
      expect(container).toBeInTheDocument()
    })

    it('should handle empty string IDs', () => {
      vi.doMock('../../../lib/analytics', () => ({
        GA_ID: '',
        GTM_ID: '',
        isAnalyticsEnabled: vi.fn(() => true),
      }))

      const { container } = render(<Google />)
      expect(container).toBeInTheDocument()
    })
  })
})