'use client'

import { useReportWebVitals } from 'next/web-vitals'
import { classifyLcpElement } from '../../lib/lcpAttribution.ts'

export function WebVitals() {
  useReportWebVitals((metric) => {
    if (process.env.NODE_ENV !== 'production') {
      return
    }

    navigator.sendBeacon(
      '/api/vitals',
      JSON.stringify({
        name: metric.name,
        ...(metric.name === 'LCP' ? { lcpElement: classifyLcpElement(metric.entries) } : {}),
        navigationType: metric.navigationType,
        path: window.location.pathname,
        rating: metric.rating,
        release: process.env.NEXT_PUBLIC_RELEASE || undefined,
        value: metric.value,
      })
    )
  })

  return null
}
