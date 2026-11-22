import { type NextRequest, NextResponse } from 'next/server'

import { findCatalogRepo } from './lib/catalog.ts'
import { buildAboutMarkdown, buildHomeMarkdown, buildRepoMarkdown, buildStatsMarkdown } from './lib/markdown.ts'
import { isRepoPageEndingInMd } from './lib/markdownPaths.ts'

const STATIC_MARKDOWN: Readonly<Record<string, () => string>> = {
  '/': buildHomeMarkdown,
  '/about': buildAboutMarkdown,
  '/stats': buildStatsMarkdown,
}

const RESERVED_REPOSITORY_ROOTS = new Set(['.well-known', '_next', 'api', 'browse', 'sitemap'])
const QUALITY_PARAMETER_PATTERN = /^q\s*=/i

// Certain malformed requests contain encoded separators or Unicode lookalikes.
// Reject them before Next.js tries to resolve them as route params.
const INVALID_PATH_CHARACTER_PATTERN = /[\uFFFD\u2044\u2215\u29F8\uFF0F\\]/u
const DOT_SEGMENT_PATTERN = /(?:^|\/)\.{2}(?:\/|$)/

function hasMalformedPath(pathname: string): boolean {
  if (INVALID_PATH_CHARACTER_PATTERN.test(pathname)) return true

  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return true
  }
  return INVALID_PATH_CHARACTER_PATTERN.test(decoded) || DOT_SEGMENT_PATTERN.test(decoded)
}

type MediaPreference = {
  quality: number
  specificity: number
}

export function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl
  const markdownApiRequest = isMarkdownApiPath(pathname)

  if (hasMalformedPath(pathname)) {
    const response = new NextResponse(null, { status: 404 })
    if (markdownApiRequest) response.headers.set('X-Robots-Tag', 'noindex')
    return response
  }

  if (markdownApiRequest) {
    const response = NextResponse.next()
    response.headers.set('X-Robots-Tag', 'noindex')
    return response
  }

  const requestedPath = pathname.slice(1)
  const accept = request.method === 'GET' || request.method === 'HEAD' ? request.headers.get('accept') : null

  if (pathname.toLowerCase().endsWith('.md')) {
    const segments = requestedPath.slice(0, -3).split('/').filter(Boolean)
    if (segments.length !== 2 || RESERVED_REPOSITORY_ROOTS.has(segments[0]?.toLowerCase() ?? '')) {
      return NextResponse.next()
    }

    // A repository name can itself end in `.md`, which makes its HTML page indistinguishable from the
    // markdown representation of a different repository.
    if (isRepoPageEndingInMd(requestedPath)) {
      if (!acceptsMarkdown(accept)) {
        return NextResponse.next()
      }

      return serveRepositoryMarkdown(request, requestedPath)
    }

    const response = rewriteRepositoryMarkdownAlias(request, segments)
    response.headers.set('X-Robots-Tag', 'noindex')
    return response
  }

  if (!acceptsMarkdown(accept)) {
    return NextResponse.next()
  }

  // The home page search and sort parameters change the HTML representation. Its static Markdown
  // alternate does not implement those views, so keep the parameterized URL in HTML.
  if (pathname === '/' && (searchParams.has('q') || searchParams.has('sort'))) {
    return NextResponse.next()
  }

  const buildMarkdown = STATIC_MARKDOWN[pathname]
  if (buildMarkdown) {
    return serveMarkdown(request, buildMarkdown())
  }

  const segments = requestedPath.split('/').filter(Boolean)
  if (segments.length !== 2 || RESERVED_REPOSITORY_ROOTS.has(segments[0]?.toLowerCase() ?? '')) {
    return NextResponse.next()
  }

  return serveRepositoryMarkdown(request, segments.join('/'))
}

export const config = {
  matcher: ['/((?!api(?:/|$)|_next(?:/|$)|og(?:/|$)|favicon\\.ico$).*)', '/api/markdown/:path*'],
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

  // Cloudflare treats text/* as a Markdown request, while equal explicit types and */* keep
  // the browser-oriented HTML default.
  return markdown.specificity === 1
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

    const qualityParameter = parameters.find((parameter) => QUALITY_PARAMETER_PATTERN.test(parameter))
    const quality = qualityParameter ? Number(qualityParameter.slice(qualityParameter.indexOf('=') + 1).trim()) : 1
    const normalizedQuality = Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 0

    if (specificity > best.specificity || (specificity === best.specificity && normalizedQuality > best.quality)) {
      best = { quality: normalizedQuality, specificity }
    }
  }

  return best
}

function rewriteRepositoryMarkdownAlias(request: NextRequest, segments: string[]) {
  const rewriteUrl = request.nextUrl.clone()
  rewriteUrl.pathname = `/api/markdown/${segments.map(encodeURIComponent).join('/')}`
  return NextResponse.rewrite(rewriteUrl)
}

function serveRepositoryMarkdown(request: NextRequest, repoPath: string) {
  const repo = findCatalogRepo(decodeURIComponent(repoPath))
  const response = serveMarkdown(request, repo ? buildRepoMarkdown(repo) : null)
  response.headers.set('Access-Control-Allow-Origin', '*')
  return response
}

function serveMarkdown(request: NextRequest, body: string | null) {
  return new NextResponse(request.method === 'HEAD' ? null : (body ?? 'Not found'), {
    status: body === null ? 404 : 200,
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': body === null ? 'text/plain; charset=utf-8' : 'text/markdown; charset=utf-8',
      vary: 'Accept',
    },
  })
}

function isMarkdownApiPath(pathname: string): boolean {
  const normalizedPath = pathname.toLowerCase()
  return normalizedPath === '/api/markdown' || normalizedPath.startsWith('/api/markdown/')
}
