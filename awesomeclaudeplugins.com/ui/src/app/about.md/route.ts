import { buildAboutMarkdown } from '../../lib/markdown.ts'

export const dynamic = 'force-static'

export function GET() {
  return new Response(buildAboutMarkdown(), {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': 'text/markdown; charset=utf-8',
    },
  })
}
