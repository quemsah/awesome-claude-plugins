import { buildHomeMarkdown } from '../../lib/markdown.ts'

export const dynamic = 'force-static'

export function GET() {
  return markdownResponse(buildHomeMarkdown())
}

function markdownResponse(content: string) {
  return new Response(content, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': 'text/markdown; charset=utf-8',
    },
  })
}
