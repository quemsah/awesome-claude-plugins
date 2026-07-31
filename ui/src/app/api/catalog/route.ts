import { NextResponse } from 'next/server'
import { searchCatalogRepos } from '../../../lib/catalog.ts'
import { CATALOG_PAGE_SIZE } from '../../../lib/catalogPagination.ts'
import { getRateLimitKey, RateLimiter } from '../../../lib/rateLimit.ts'
import { parseSortOption } from '../../../lib/searchState.ts'

const MAX_PAGE_SIZE = 100
/**
 * Fuzzy search cost grows linearly past Fuse's 32-character bitap pattern limit, so longer
 * queries are truncated instead of rejected: the search box has no length limit and a 400 would
 * surface to the user as a load error.
 */
const MAX_QUERY_LENGTH = 32
const MAX_REQUESTS_PER_MINUTE = 100
const rateLimiter = new RateLimiter(10_000, MAX_REQUESTS_PER_MINUTE, 60_000)

export function GET(request: Request) {
  if (rateLimiter.isRateLimited(getRateLimitKey(request.headers))) {
    return NextResponse.json({ message: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
  }

  const searchParams = new URL(request.url).searchParams
  const page = Number.parseInt(searchParams.get('page') ?? '0', 10)
  const pageSize = Number.parseInt(searchParams.get('pageSize') ?? `${CATALOG_PAGE_SIZE}`, 10)

  if (!(Number.isSafeInteger(page) && page >= 0 && Number.isSafeInteger(pageSize) && pageSize > 0 && pageSize <= MAX_PAGE_SIZE)) {
    return NextResponse.json({ message: 'Invalid pagination parameters' }, { status: 400 })
  }

  const query = (searchParams.get('q') ?? '').slice(0, MAX_QUERY_LENGTH)

  return NextResponse.json(searchCatalogRepos(query, parseSortOption(searchParams.get('sort')), page, pageSize), {
    headers: {
      'Cache-Control': 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
