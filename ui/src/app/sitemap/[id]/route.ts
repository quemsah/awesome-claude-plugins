import type { MetadataRoute } from 'next'
import { getSitemapShard, getSitemapShardCount } from '../../../lib/sitemap.ts'

export const dynamic = 'force-static'

const SITEMAP_ID_PATTERN = /^\d+$/

type RouteContext = {
  params: Promise<{ id: string }>
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function formatLastModified(value: MetadataRoute.Sitemap[number]['lastModified']): string {
  return value instanceof Date ? value.toISOString() : new Date(value ?? 0).toISOString()
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { id: rawId } = await params
  if (!SITEMAP_ID_PATTERN.test(rawId)) return new Response('Not Found', { status: 404 })
  const id = Number(rawId)
  if (!Number.isSafeInteger(id) || id < 0 || id >= getSitemapShardCount()) return new Response('Not Found', { status: 404 })

  const entries = getSitemapShard(id)
    .map((entry) => {
      const lastModified = entry.lastModified ? `<lastmod>${formatLastModified(entry.lastModified)}</lastmod>` : ''
      return `  <url><loc>${escapeXml(entry.url)}</loc>${lastModified}</url>`
    })
    .join('\n')
  const content = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`

  return new Response(content, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
