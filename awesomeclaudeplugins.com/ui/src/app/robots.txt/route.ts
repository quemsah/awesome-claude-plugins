import { BASE_URL } from '../../lib/constants.ts'

export const dynamic = 'force-static'

const userAgents = ['*', 'GPTBot', 'ClaudeBot', 'OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Google-Extended']
// `/api/catalog` stays crawlable: the API catalog and `llms.txt` publish it as the machine-queryable
// entry point, so excluding all of `/api/` would tell agents to avoid the one endpoint they need.
const disallowedPaths = ['/api/reports', '/api/vitals']

export function GET() {
  const rules = userAgents
    .map((userAgent) => [`User-agent: ${userAgent}`, 'Allow: /', ...disallowedPaths.map((path) => `Disallow: ${path}`)].join('\n'))
    .join('\n\n')
  const content = `${rules}

Content-Signal: search=yes, ai-input=yes, ai-train=yes
Sitemap: ${BASE_URL}/sitemap.xml
`

  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
