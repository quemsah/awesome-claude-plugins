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
        rating: metric.rating,
        value: metric.value,
      })
    )
  })

  return null
}
