import { BASE_URL } from '../../lib/constants.ts'

export const dynamic = 'force-static'

export function GET() {
  const userAgents = ['*', 'GPTBot', 'ClaudeBot', 'OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Google-Extended']
  const rules = userAgents.map((userAgent) => `User-agent: ${userAgent}\nAllow: /\nDisallow: /api/`).join('\n\n')
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
