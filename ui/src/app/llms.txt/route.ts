export const dynamic = 'force-static'

import reposData from '../../data/repos.json' with { type: 'json' }
import statsData from '../../data/stats.json' with { type: 'json' }
import { buildLlmsText, getCatalogSummary } from '../../lib/llmsText'

export function GET() {
  const llmsContent = buildLlmsText(getCatalogSummary(reposData, statsData))

  return new Response(llmsContent, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
