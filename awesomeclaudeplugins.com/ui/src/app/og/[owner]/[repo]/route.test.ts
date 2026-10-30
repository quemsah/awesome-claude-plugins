import { describe, expect, it } from 'vitest'
import { sanitizeOgDescription } from '../../../../lib/ogText.ts'
import { GET } from './route.tsx'

const catalogOwner = 'ykdojo'
const catalogRepo = 'claude-code-tips'

function get(owner: string, repo: string) {
  return GET(new Request(`http://localhost/og/${owner}/${repo}`), { params: Promise.resolve({ owner, repo }) })
}

describe('GET /og/[owner]/[repo]', () => {
  it('keeps multilingual text but excludes symbols that trigger dynamic font fallback', () => {
    expect(sanitizeOgDescription('  ✻ Tools 🚀 for Ελληνικά and Русский  ')).toBe('Tools for Ελληνικά and Русский')
    expect(sanitizeOgDescription('✨ ✻ 🚀')).toBe('')
  })

  it('renders a PNG for a catalog repository', async () => {
    const response = await get(catalogOwner, catalogRepo)
    const body = await response.arrayBuffer()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(body.byteLength).toBeGreaterThan(0)
  }, 15_000)

  it('returns 404 for a repository outside the catalog', async () => {
    const response = await get('not-a-repository', 'not-a-repository')

    expect(response.status).toBe(404)
  })
})
