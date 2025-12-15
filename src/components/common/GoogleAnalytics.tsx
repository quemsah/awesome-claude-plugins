/** biome-ignore-all lint/security/noDangerouslySetInnerHtml: <ga> */
'use client'

import { usePathname } from 'next/navigation'
import Script from 'next/script'
import { useEffect } from 'react'
import { GA_ID, isAnalyticsEnabled } from '../../lib/analytics.ts'

declare global {
  interface Window {
    gtag: (...args: unknown[]) => void
  }
}

export default function GoogleAnalytics() {
  const pathname = usePathname()

  useEffect(() => {
    if (!isAnalyticsEnabled()) return
    // biome-ignore lint/style/useNamingConvention: GA parameter name
    globalThis.gtag('config', GA_ID, { page_path: pathname })
  }, [pathname])

  if (!isAnalyticsEnabled()) {
    return null
  }
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
      <Script
        dangerouslySetInnerHTML={{
          __html: `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_ID}', {
              page_path: window.location.pathname,
            });
          `,
        }}
        id="gtag-init"
        strategy="afterInteractive"
      />
    </>
  )
}
