'use client'

import Script from 'next/script'
import { useEffect, useState } from 'react'

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
    if (enabled && navigator.globalPrivacyControl !== true) {
      setMayLoad(true)
    }
  }, [enabled])

  return mayLoad ? (
    <Script data-collect-dnt="true" src="https://scripts.simpleanalyticscdn.com/latest.js" strategy="afterInteractive" />
  ) : null
}
