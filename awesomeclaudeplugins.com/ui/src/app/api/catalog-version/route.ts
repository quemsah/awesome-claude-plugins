import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const dynamic = 'force-static'

function getCatalogVersionHash(): string {
  const indexFile = join(process.cwd(), 'src/data/search-index.json')
  const reposFile = join(process.cwd(), 'src/data/repos.json')
  const fileToHash = existsSync(indexFile) ? indexFile : reposFile
  if (!existsSync(fileToHash)) return ''
  const content = readFileSync(fileToHash)
  return createHash('sha256').update(content).digest('hex')
}

const sha256 = getCatalogVersionHash()

export function GET() {
  return new Response(JSON.stringify({ sha256 }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
