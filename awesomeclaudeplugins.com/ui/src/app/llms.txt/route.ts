export const dynamic = 'force-static'

import statsData from '../../data/stats.json' with { type: 'json' }
import { getCanonicalCatalogRepos } from '../../lib/catalog.ts'
import { buildLlmsText, getCatalogSummary } from '../../lib/llmsText'

export function GET() {
  const llmsContent = buildLlmsText(getCatalogSummary(getCanonicalCatalogRepos(), statsData))

  return new Response(llmsContent, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
