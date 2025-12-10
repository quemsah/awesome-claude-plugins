'use client'

import { useReportWebVitals } from 'next/web-vitals'
import { reportWebVitals } from '../lib/analytics.ts'

export function WebVitals() {
  useReportWebVitals((metric) => {
    reportWebVitals(metric)
  })
  return null
}
