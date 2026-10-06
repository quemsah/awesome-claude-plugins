import { type NextRequest, NextResponse } from 'next/server'

import { isRepoPageEndingInMd } from './lib/markdownPaths.ts'

const STATIC_MARKDOWN_PATHS: Readonly<Record<string, string>> = {
  '/': '/index.md',
  '/about': '/about.md',
  '/stats': '/stats.md',
}

const RESERVED_REPOSITORY_ROOTS = new Set(['.well-known', '_next', 'api', 'browse', 'sitemap'])

type MediaPreference = {
  quality: number
  specificity: number
}

export function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl
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

  // The home page search and sort parameters change the HTML representation. Its static Markdown
  // alternate does not implement those views, so keep the parameterized URL in HTML.
  if (pathname === '/' && (searchParams.has('q') || searchParams.has('sort'))) {
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

  const markdown = getMediaPreference(accept, 'text/markdown')
  if (markdown.specificity < 0 || markdown.quality <= 0) {
    return false
  }

  const html = getMediaPreference(accept, 'text/html')
  if (html.specificity < 0 || html.quality <= 0) {
    return true
  }

  if (markdown.quality !== html.quality) {
    return markdown.quality > html.quality
  }

  if (markdown.specificity !== html.specificity) {
    return markdown.specificity > html.specificity
  }

  // A text wildcard still expresses a preference for a text representation, while */* keeps
  // the browser-oriented HTML default.
  return markdown.specificity > 0
}

function getMediaPreference(accept: string, target: string): MediaPreference {
  const [targetType, targetSubtype] = target.toLowerCase().split('/')
  let best: MediaPreference = { quality: 0, specificity: -1 }

  for (const range of accept.split(',')) {
    const [mediaType = '', ...parameters] = range.split(';').map((part) => part.trim())
    const [type, subtype] = mediaType.toLowerCase().split('/')

    let specificity = -1
    if (type === targetType && subtype === targetSubtype) {
      specificity = 2
    } else if (type === targetType && subtype === '*') {
      specificity = 1
    } else if (type === '*' && subtype === '*') {
      specificity = 0
    }

    if (specificity < 0) {
      continue
    }

    const qualityParameter = parameters.find((parameter) => /^q\s*=/i.test(parameter))
    const quality = qualityParameter ? Number(qualityParameter.slice(qualityParameter.indexOf('=') + 1).trim()) : 1
    const normalizedQuality = Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 0

    if (specificity > best.specificity) {
      best = { quality: normalizedQuality, specificity }
    }
  }

  return best
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
