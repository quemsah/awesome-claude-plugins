export const dynamic = 'force-static'

import { getPublishedCatalogSummary } from '../../lib/catalog.ts'
import { buildLlmsText } from '../../lib/llmsText.ts'

export function GET() {
  const llmsContent = buildLlmsText(getPublishedCatalogSummary())

  return new Response(llmsContent, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
