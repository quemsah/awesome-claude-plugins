import { BASE_URL } from '../../../lib/constants.ts'

export const dynamic = 'force-static'

export function GET() {
  const linkset = {
    linkset: [
      {
        anchor: BASE_URL,
        link: [
          { href: `${BASE_URL}/sitemap.xml`, rel: 'sitemap', type: 'application/xml' },
          { href: `${BASE_URL}/llms.txt`, rel: 'describedby', type: 'text/plain' },
          { href: `${BASE_URL}/manifest.webmanifest`, rel: 'manifest', type: 'application/manifest+json' },
          { href: `${BASE_URL}/.well-known/agent-skills/index.json`, rel: 'service-desc', type: 'application/json' },
        ],
      },
    ],
  }

  return Response.json(linkset, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': 'application/linkset+json; charset=utf-8',
    },
  })
}
