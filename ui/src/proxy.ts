import { type NextRequest, NextResponse } from 'next/server'

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (!pathname.endsWith('.md')) {
    return NextResponse.next()
  }

  const repoPath = pathname.slice(1, -3)
  const segments = repoPath.split('/').filter(Boolean)
  if (segments.length !== 2) {
    return NextResponse.next()
  }

  const rewriteUrl = request.nextUrl.clone()
  rewriteUrl.pathname = `/api/markdown/${segments.map(encodeURIComponent).join('/')}`
  return NextResponse.rewrite(rewriteUrl)
}
