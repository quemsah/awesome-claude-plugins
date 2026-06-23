import { type NextRequest, NextResponse } from 'next/server'
import { DEFAULT_PAGE_SIZE, parseSortOption, searchRepos } from '../../../../lib/repoSearch.ts'

export function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const query = searchParams.get('q') ?? ''
  const sortOption = parseSortOption(searchParams.get('sort'))
  const page = Number(searchParams.get('page') ?? '1')
  const pageSize = Number(searchParams.get('pageSize') ?? String(DEFAULT_PAGE_SIZE))

  return NextResponse.json(searchRepos({ query, sortOption, page, pageSize }))
}
