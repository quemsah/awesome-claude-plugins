import { type NextRequest, NextResponse } from 'next/server'

import { isRepoPageEndingInMd } from './lib/markdownPaths.ts'

const STATIC_MARKDOWN_PATHS: Readonly<Record<string, string>> = {
  '/': '/index.md',
  '/about': '/about.md',
  '/stats': '/stats.md',
}

const RESERVED_REPOSITORY_ROOTS = new Set(['.well-known', '_next', 'api', 'browse', 'sitemap'])

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const requestedPath = pathname.slice(1)
  const accept = request.headers.get('accept')

  if (pathname.toLowerCase().endsWith('.md')) {
    const segments = requestedPath.slice(0, -3).split('/').filter(Boolean)
    if (segments.length !== 2) {
      return NextResponse.next()
    }

    // A repository name can itself end in `.md`, which makes its HTML page indistinguishable from the
    // markdown representation of a different repository.
    if (isRepoPageEndingInMd(requestedPath)) {
      if (!acceptsMarkdown(accept)) {
        return NextResponse.next()
      }

      return rewriteRepositoryMarkdown(request, requestedPath.split('/').filter(Boolean), true)
    }

    return rewriteRepositoryMarkdown(request, segments)
  }

  if (!acceptsMarkdown(accept)) {
    return NextResponse.next()
  }

  const staticMarkdownPath = STATIC_MARKDOWN_PATHS[pathname]
  if (staticMarkdownPath) {
    return rewriteMarkdown(request, staticMarkdownPath, true)
  }

  const segments = requestedPath.split('/').filter(Boolean)
  if (segments.length !== 2 || RESERVED_REPOSITORY_ROOTS.has(segments[0]?.toLowerCase() ?? '')) {
    return NextResponse.next()
  }

  return rewriteRepositoryMarkdown(request, segments, true)
}

function acceptsMarkdown(accept: string | null): boolean {
  if (!accept) {
    return false
  }

  return accept.split(',').some((range) => {
    const [mediaType = '', ...parameters] = range.split(';').map((part) => part.trim())
    if (mediaType.toLowerCase() !== 'text/markdown') {
      return false
    }

    const qualityParameter = parameters.find((parameter) => parameter.toLowerCase().startsWith('q='))
    if (!qualityParameter) {
      return true
    }

    const quality = Number(qualityParameter.slice(2).trim())
    return Number.isFinite(quality) && quality > 0
  })
}

function rewriteRepositoryMarkdown(request: NextRequest, segments: string[], varyOnAccept = false) {
  return rewriteMarkdown(request, `/api/markdown/${segments.map(encodeURIComponent).join('/')}`, varyOnAccept)
}

function rewriteMarkdown(request: NextRequest, pathname: string, varyOnAccept: boolean) {
  const rewriteUrl = request.nextUrl.clone()
  rewriteUrl.pathname = pathname
  const response = NextResponse.rewrite(rewriteUrl)

  if (varyOnAccept) {
    response.headers.set('Vary', 'Accept')
  }

  return response
}
