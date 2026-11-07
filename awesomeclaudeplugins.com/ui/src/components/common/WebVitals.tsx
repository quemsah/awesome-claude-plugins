'use client'

import { useReportWebVitals } from 'next/web-vitals'

export function WebVitals() {
  useReportWebVitals((metric) => {
    if (process.env.NODE_ENV !== 'production') {
      return
    }

    const lcpEntry = metric.name === 'LCP' ? (metric.entries.at(-1) as LargestContentfulPaint | undefined) : undefined
    const lcpResourceOrigin = getHttpOrigin(lcpEntry?.url)

    navigator.sendBeacon(
      '/api/vitals',
      JSON.stringify({
        name: metric.name,
        navigationType: metric.navigationType,
        path: window.location.pathname,
        lcpElementType: lcpEntry?.element?.tagName,
        lcpResourceOrigin,
        rating: metric.rating,
        release: process.env.NEXT_PUBLIC_RELEASE || undefined,
        value: metric.value,
      })
    )
  })

  return null
}

function getHttpOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined

  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : undefined
  } catch (error) {
    if (error instanceof TypeError) return undefined
    throw error
  }
}
