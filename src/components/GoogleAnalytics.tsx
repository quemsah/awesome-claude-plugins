'use client'

import { GoogleAnalytics as NextGoogleAnalytics } from '@next/third-parties/google'
import { GA_MEASUREMENT_ID, isAnalyticsEnabled } from '../lib/analytics.ts'

export { reportWebVitals, trackEvent, trackPageView } from '../lib/analytics.ts'

export default function GoogleAnalytics() {
  if (!isAnalyticsEnabled()) {
    return null
  }
  console.log('Google Analytics is enabled with ID:', GA_MEASUREMENT_ID)
  console.log(<NextGoogleAnalytics gaId={GA_MEASUREMENT_ID} />)
  return <NextGoogleAnalytics gaId={GA_MEASUREMENT_ID} />
}
