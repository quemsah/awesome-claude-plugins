'use client'

import Script from 'next/script'
import { useEffect, useState } from 'react'
import { flushPendingEvents, isPrivacyRestricted, SIMPLE_ANALYTICS_IGNORED_METRICS } from '../../lib/analytics.ts'

declare global {
  interface Navigator {
    globalPrivacyControl?: boolean
  }
}

type SimpleAnalyticsProps = {
  enabled: boolean
}

export function SimpleAnalytics({ enabled }: SimpleAnalyticsProps) {
  const [mayLoad, setMayLoad] = useState(false)

  useEffect(() => {
    setMayLoad(enabled && !isPrivacyRestricted())
  }, [enabled])

  return mayLoad ? (
    <Script
      data-ignore-metrics={SIMPLE_ANALYTICS_IGNORED_METRICS}
      onReady={flushPendingEvents}
      src="https://scripts.simpleanalyticscdn.com/latest.js"
      strategy="afterInteractive"
    />
  ) : null
}
