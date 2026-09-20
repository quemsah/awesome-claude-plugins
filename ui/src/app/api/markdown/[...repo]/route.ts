import { findCatalogRepo } from '../../../../lib/catalog.ts'
import { buildRepoMarkdown } from '../../../../lib/markdown.ts'

type RouteContext = {
  params: Promise<{ repo: string[] }>
}

export function GET(_request: Request, { params }: RouteContext) {
  return params.then(({ repo }) => {
    if (repo.length !== 2) {
      return new Response('Not found', { status: 404 })
    }

    const catalogRepo = findCatalogRepo(repo.join('/'))
    if (!catalogRepo) {
      return new Response('Not found', { status: 404 })
    }

    return new Response(buildRepoMarkdown(catalogRepo), {
      headers: {
        // `proxy.ts` rewrites /{owner}/{repo}.md onto this handler, so the policy has to travel
        // with the Response: `next.config.ts` headers match the pre-rewrite path.
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
        'Content-Type': 'text/markdown; charset=utf-8',
      },
    })
  })
}
