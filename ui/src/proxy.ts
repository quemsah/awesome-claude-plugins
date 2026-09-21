import { type NextRequest, NextResponse } from 'next/server'

import { isRepoPageEndingInMd } from './lib/markdownPaths.ts'

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (!pathname.toLowerCase().endsWith('.md')) {
    return NextResponse.next()
  }

  const requestedPath = pathname.slice(1)
  const segments = requestedPath.slice(0, -3).split('/').filter(Boolean)
  if (segments.length !== 2) {
    return NextResponse.next()
  }

  // A repository name can itself end in `.md`, which makes its HTML page indistinguishable from the
  // markdown representation of a different repository.
  if (isRepoPageEndingInMd(requestedPath)) {
    return NextResponse.next()
  }

  const rewriteUrl = request.nextUrl.clone()
  rewriteUrl.pathname = `/api/markdown/${segments.map(encodeURIComponent).join('/')}`
  return NextResponse.rewrite(rewriteUrl)
}
