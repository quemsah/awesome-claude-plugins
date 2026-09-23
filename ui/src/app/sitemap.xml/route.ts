import { getCatalogLastModified } from '../../lib/catalog.ts'
import { BASE_URL } from '../../lib/constants.ts'
import { getSitemapShardCount } from '../../lib/sitemap.ts'

export const dynamic = 'force-static'

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

export function GET() {
  const lastModified = getCatalogLastModified().toISOString()
  const entries = Array.from({ length: getSitemapShardCount() }, (_, id) => {
    const location = `${BASE_URL}/sitemap-${id}.xml`
    return `  <sitemap><loc>${escapeXml(location)}</loc><lastmod>${lastModified}</lastmod></sitemap>`
  }).join('\n')
  const content = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>\n`

  return new Response(content, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
