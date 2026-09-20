import { API_CATALOG_MEDIA_TYPE, API_CATALOG_PROFILE_URI, buildApiCatalogLinkset } from '../../../lib/discovery.ts'

export const dynamic = 'force-static'

export function GET() {
  return Response.json(buildApiCatalogLinkset(), {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': `${API_CATALOG_MEDIA_TYPE}; charset=utf-8; profile="${API_CATALOG_PROFILE_URI}"`,
    },
  })
}
