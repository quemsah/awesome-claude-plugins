'use client'

import { useReportWebVitals } from 'next/web-vitals'

export function WebVitals() {
  useReportWebVitals((metric) => {
    if (process.env.NODE_ENV !== 'production') {
      return
    }

    navigator.sendBeacon(
      '/api/vitals',
      JSON.stringify({
        name: metric.name,
        navigationType: metric.navigationType,
        path: window.location.pathname,
        rating: metric.rating,
        release: process.env.NEXT_PUBLIC_RELEASE,
        value: metric.value,
      })
    )
  })

  return null
}
