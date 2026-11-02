import { sqliteGetCatalogVersionHash } from '../../../lib/sqliteCatalogStore.ts'

export const dynamic = 'force-static'

const sha256 = sqliteGetCatalogVersionHash()

export function GET() {
  return new Response(JSON.stringify({ sha256 }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
