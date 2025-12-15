/** biome-ignore-all lint/style/useNamingConvention: <ga> */
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
    // deno-lint-ignore no-window
    window.gtag('config', GA_ID, { page_path: pathname })
  }, [pathname])

  if (!isAnalyticsEnabled()) {
    return null
  }
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
      <Script
        // biome-ignore lint/security/noDangerouslySetInnerHtml: <ga>
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
