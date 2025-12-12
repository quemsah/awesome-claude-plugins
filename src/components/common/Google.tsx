'use client'

import { GoogleAnalytics, GoogleTagManager } from '@next/third-parties/google'
import { GA_ID, GTM_ID, isAnalyticsEnabled } from '../../lib/analytics.ts'

export { reportWebVitals, trackEvent, trackPageView } from '../../lib/analytics.ts'

export default function Google() {
  if (!isAnalyticsEnabled()) {
    return null
  }
  return (
    <>
      <GoogleAnalytics gaId={GA_ID} />
      <GoogleTagManager gtmId={GTM_ID} />
    </>
  )
}
