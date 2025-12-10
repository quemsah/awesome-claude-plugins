'use client'

import { GoogleAnalytics as NextGoogleAnalytics } from '@next/third-parties/google'
import { GA_MEASUREMENT_ID, isAnalyticsEnabled } from '../lib/analytics.ts'

export { analytics, reportWebVitals, trackEvent, trackPageView } from '../lib/analytics.ts'

export default function GoogleAnalytics() {
  if (!isAnalyticsEnabled()) {
    return null
  }
  return <NextGoogleAnalytics gaId={GA_MEASUREMENT_ID} />
}
