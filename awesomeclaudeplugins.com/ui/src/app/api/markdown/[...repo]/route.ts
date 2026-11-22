import { findCatalogRepo } from '../../../../lib/catalog.ts'
import { buildRepoMarkdown } from '../../../../lib/markdown.ts'
import { getMarkdownResponseHeaders } from '../../../../lib/markdownResponse.ts'

type RouteContext = {
  params: Promise<{ repo: string[] }>
}

// `proxy.ts` rewrites /{owner}/{repo}.md onto this handler, so CORS has to travel with the
// Response itself: `next.config.ts` headers match the pre-rewrite path and would miss it.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
}

export function GET(_request: Request, { params }: RouteContext) {
  return params.then(({ repo }) => {
    if (repo.length !== 2) {
      return notFound()
    }

    const catalogRepo = findCatalogRepo(repo.join('/'))
    if (!catalogRepo) {
      return notFound()
    }

    return new Response(buildRepoMarkdown(catalogRepo), {
      headers: {
        ...CORS_HEADERS,
        ...Object.fromEntries(getMarkdownResponseHeaders('public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800')),
      },
    })
  })
}

export function HEAD(request: Request, context: RouteContext) {
  return GET(request, context).then((response) => new Response(null, { status: response.status, headers: response.headers }))
}

export function OPTIONS(_request: Request) {
  const headers = new Headers({
    ...CORS_HEADERS,
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Max-Age': '86400',
  })
  headers.set('X-Robots-Tag', 'noindex')

  return new Response(null, {
    status: 204,
    headers,
  })
}

function notFound() {
  const headers = new Headers({ ...CORS_HEADERS, 'Cache-Control': 'no-store' })
  headers.set('Content-Type', 'text/plain; charset=utf-8')
  headers.set('X-Robots-Tag', 'noindex')

  return new Response('Not found', { status: 404, headers })
}
