'use client'

import Script from 'next/script'
import { useEffect, useState } from 'react'
import { flushPendingEvents, isPrivacyRestricted } from '../../lib/analytics.ts'

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
    <Script onReady={flushPendingEvents} src="https://scripts.simpleanalyticscdn.com/latest.js" strategy="afterInteractive" />
  ) : null
}
