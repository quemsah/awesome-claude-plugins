/** biome-ignore-all lint/security/noDangerouslySetInnerHtml: <ga> */
'use client'

import { GA_ID, isAnalyticsEnabled } from '../../lib/analytics.ts'

export { reportWebVitals, trackEvent, trackPageView } from '../../lib/analytics.ts'

export default function Google() {
  if (!isAnalyticsEnabled()) {
    return null
  }
  return (
    <>
      <script async data-strategy="afterInteractive" src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} />
      <script
        dangerouslySetInnerHTML={{
          __html: `
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${GA_ID}');
              `,
        }}
        data-strategy="afterInteractive"
      />
    </>
  )
}
