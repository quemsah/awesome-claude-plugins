import { buildAboutMarkdown } from '../../lib/markdown.ts'
import { getMarkdownResponseHeaders } from '../../lib/markdownResponse.ts'

export const dynamic = 'force-static'

export function GET() {
  return new Response(buildAboutMarkdown(), {
    headers: getMarkdownResponseHeaders('public, max-age=3600'),
  })
}
