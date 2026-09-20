import { findCatalogRepo } from '../../../../lib/catalog.ts'
import { buildRepoMarkdown } from '../../../../lib/markdown.ts'

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
        'Cache-Control': 'public, max-age=3600',
        'Content-Type': 'text/markdown; charset=utf-8',
      },
    })
  })
}

export function OPTIONS(_request: Request) {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Max-Age': '86400',
    },
  })
}

function notFound() {
  return new Response('Not found', { status: 404, headers: CORS_HEADERS })
}
