import { BASE_URL, SOURCE_REPOSITORY_URL } from '../../../lib/constants.ts'

export const dynamic = 'force-static'

export function GET() {
  const content = `Contact: ${SOURCE_REPOSITORY_URL}/issues
Canonical: ${BASE_URL}/.well-known/security.txt
`

  return new Response(content, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  })
}
