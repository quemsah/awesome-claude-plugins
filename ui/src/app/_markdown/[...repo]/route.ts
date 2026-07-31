import { findCatalogRepo } from '../../../lib/catalog.ts'
import { buildRepoMarkdown } from '../../../lib/markdown.ts'

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
        'Cache-Control': 'public, max-age=3600',
        'Content-Type': 'text/markdown; charset=utf-8',
      },
    })
  })
}
