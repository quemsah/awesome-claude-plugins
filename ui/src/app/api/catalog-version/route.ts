import { createHash } from 'node:crypto'
import catalog from '../../../data/repos.json' with { type: 'json' }

// Built from the deployed catalog, not the GitHub Actions checkout.
export const dynamic = 'force-static'
const sha256 = createHash('sha256').update(JSON.stringify(catalog)).digest('hex')

export function GET() {
  return new Response(JSON.stringify({ sha256 }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
