import { buildHomeMarkdown } from '../../lib/markdown.ts'
import { getMarkdownResponseHeaders } from '../../lib/markdownResponse.ts'

export const dynamic = 'force-static'

export function GET() {
  return new Response(buildHomeMarkdown(), {
    headers: getMarkdownResponseHeaders('public, max-age=3600'),
  })
}
