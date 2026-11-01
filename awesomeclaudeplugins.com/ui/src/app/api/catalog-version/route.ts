import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const dynamic = 'force-static'

function getCatalogVersionHash(): string {
  const reposFile = process.env.CATALOG_DATA_PATH || join(process.cwd(), 'src/data/repos.json')
  if (!existsSync(reposFile)) return ''
  try {
    const repos = JSON.parse(readFileSync(reposFile, 'utf8'))
    return createHash('sha256').update(JSON.stringify(repos)).digest('hex')
  } catch {
    return ''
  }
}

const sha256 = getCatalogVersionHash()

export function GET() {
  return new Response(JSON.stringify({ sha256 }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
