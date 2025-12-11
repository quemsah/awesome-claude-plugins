'use client'

import { useReportWebVitals } from 'next/web-vitals'
import { reportWebVitals } from '../lib/analytics.ts'

export function WebVitals() {
  useReportWebVitals((metric) => {
    console.log("🚀 ~ WebVitals ~ metric:", metric)
    reportWebVitals(metric)
  })
  return null
}
