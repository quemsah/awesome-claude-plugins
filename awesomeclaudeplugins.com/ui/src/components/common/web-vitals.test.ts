import { afterEach, describe, expect, it, vi } from 'vitest'

const useReportWebVitals = vi.hoisted(() => vi.fn())
vi.mock('next/web-vitals', () => ({ useReportWebVitals }))

import { WebVitals } from './WebVitals.tsx'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  useReportWebVitals.mockReset()
})

describe('WebVitals', () => {
  it('sends only the LCP element type and resource origin', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const sendBeacon = vi.fn()
    vi.stubGlobal('navigator', { sendBeacon })
    vi.stubGlobal('window', { location: { pathname: '/alice/repo' } })

    WebVitals()
    const report = useReportWebVitals.mock.calls[0]?.[0]
    report?.({
      name: 'LCP',
      navigationType: 'navigate',
      entries: [
        {
          url: 'https://avatars.githubusercontent.com/u/123?token=private',
          element: { tagName: 'IMG' },
        } as LargestContentfulPaint,
      ],
      rating: 'poor',
      value: 8_000,
    })

    expect(sendBeacon).toHaveBeenCalledTimes(1)
    expect(sendBeacon).toHaveBeenCalledWith(
      '/api/vitals',
      JSON.stringify({
        name: 'LCP',
        navigationType: 'navigate',
        path: '/alice/repo',
        lcpElementType: 'IMG',
        lcpResourceOrigin: 'https://avatars.githubusercontent.com',
        rating: 'poor',
        release: undefined,
        value: 8_000,
      })
    )
    expect(sendBeacon.mock.calls[0]?.[1]).not.toContain('/u/123')
    expect(sendBeacon.mock.calls[0]?.[1]).not.toContain('token=private')
  })
})
