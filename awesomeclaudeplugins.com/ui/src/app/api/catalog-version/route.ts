import { sqliteGetCatalogMetadata } from '../../../lib/sqliteCatalogStore.ts'

export const dynamic = 'force-static'

export function GET() {
  const metadata = sqliteGetCatalogMetadata()
  return new Response(
    JSON.stringify({
      sha256: metadata.catalog_fingerprint,
      snapshotId: metadata.snapshot_id,
    }),
    {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    }
  )
}
