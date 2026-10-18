import { NextResponse } from 'next/server'
import { searchCatalogRepos } from '../../../lib/catalog.ts'
import { CATALOG_PAGE_SIZE } from '../../../lib/catalogPagination.ts'
import { getRateLimitKey, RateLimiter } from '../../../lib/rateLimit.ts'
import { parseSortOption } from '../../../lib/searchState.ts'

const MAX_PAGE_SIZE = 100
const DECIMAL_INTEGER_PATTERN = /^\d+$/
const MAX_REQUESTS_PER_MINUTE = 100
const rateLimiter = new RateLimiter(10_000, MAX_REQUESTS_PER_MINUTE, 60_000)

export function GET(request: Request) {
  if (rateLimiter.isRateLimited(getRateLimitKey(request.headers))) {
    return NextResponse.json({ message: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
  }

  const searchParams = new URL(request.url).searchParams
  const pageValue = searchParams.get('page') ?? '0'
  const pageSizeValue = searchParams.get('pageSize') ?? `${CATALOG_PAGE_SIZE}`
  const page = Number(pageValue)
  const pageSize = Number(pageSizeValue)

  const validPage = DECIMAL_INTEGER_PATTERN.test(pageValue) && Number.isSafeInteger(page) && page >= 0
  const validPageSize =
    DECIMAL_INTEGER_PATTERN.test(pageSizeValue) && Number.isSafeInteger(pageSize) && pageSize > 0 && pageSize <= MAX_PAGE_SIZE

  if (!(validPage && validPageSize)) {
    return NextResponse.json({ message: 'Invalid pagination parameters' }, { status: 400 })
  }

  // `searchCatalogRepos` owns query normalization, including the length cap, so this route cannot
  // drift from the server initial render it pages alongside.
  const query = searchParams.get('q') ?? ''
  const searchResult = searchCatalogRepos(query, parseSortOption(searchParams.get('sort')), page, pageSize)

  return NextResponse.json(
    searchResult,
    {
      headers: {
        'Cache-Control': 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400',
      },
    }
  )
}
