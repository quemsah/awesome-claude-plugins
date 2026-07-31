'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useDebouncedCallback } from 'use-debounce'
import { CATALOG_PAGE_SIZE } from '../../lib/catalogPagination.ts'
import { buildSearchUrl, parseSortOption } from '../../lib/searchState.ts'
import type { SortOption } from '../../lib/sortOptions.ts'
import type { Repo } from '../../schemas/repo.schema.ts'
import { RepoList } from './RepoList.tsx'
import { SearchControls } from './SearchControls.tsx'

interface SearchPageProps {
  initialRepos: readonly Repo[]
  initialPluginCount: number
  initialSearchTerm: string
  initialSortOption: SortOption
  initialTotal: number
}

type CatalogApiResponse = {
  hasMore: boolean
  pluginsCount: number
  repos: Repo[]
  total: number
}

export function SearchPage({ initialPluginCount, initialRepos, initialSearchTerm, initialSortOption, initialTotal }: SearchPageProps) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [sortOption, setSortOption] = useState<SortOption>(parseSortOption(initialSortOption))
  const [searchTerm, setSearchTerm] = useState(initialSearchTerm)
  const [queriedSearchTerm, setQueriedSearchTerm] = useState(initialSearchTerm)
  const [repos, setRepos] = useState<readonly Repo[]>(initialRepos)
  const [pluginsCount, setPluginsCount] = useState(initialPluginCount)
  const [total, setTotal] = useState(initialTotal)
  const [hasMore, setHasMore] = useState(initialTotal > initialRepos.length)
  const [isLoading, setIsLoading] = useState(false)
  const [hasLoadError, setHasLoadError] = useState(false)
  const initialRequest = useRef(true)
  const nextPage = useRef(1)
  const loadingController = useRef<AbortController | null>(null)

  const updateSearchUrl = useCallback(
    (nextSearchTerm: string, nextSortOption: SortOption, mode: 'push' | 'replace' = 'push') => {
      const currentSearch = searchParams.size > 0 ? `?${searchParams}` : ''
      const nextUrl = buildSearchUrl(pathname, currentSearch, {
        searchTerm: nextSearchTerm,
        sortOption: nextSortOption,
      })

      if (nextUrl !== `${pathname}${currentSearch}`) {
        router[mode](nextUrl, { scroll: false })
      }
      window.sessionStorage.setItem('last-search-url', nextUrl)
    },
    [pathname, router, searchParams]
  )

  const debouncedReplaceSearchUrl = useDebouncedCallback((nextSearchTerm: string, nextSortOption: SortOption) => {
    updateSearchUrl(nextSearchTerm, nextSortOption, 'replace')
  }, 500)

  // Keystrokes update the input immediately but only settle into a catalog request once typing
  // pauses, so a single search costs one round trip instead of one per character.
  const debouncedQuerySearchTerm = useDebouncedCallback(setQueriedSearchTerm, 300)

  const handleSearchChange = useCallback(
    (nextSearchTerm: string) => {
      setSearchTerm(nextSearchTerm)
      debouncedQuerySearchTerm(nextSearchTerm)
      debouncedReplaceSearchUrl(nextSearchTerm, sortOption)
    },
    [debouncedQuerySearchTerm, debouncedReplaceSearchUrl, sortOption]
  )

  const handleSortChange = useCallback(
    (nextSortOption: SortOption) => {
      setSortOption(nextSortOption)
      updateSearchUrl(searchTerm, nextSortOption)
    },
    [searchTerm, updateSearchUrl]
  )

  useEffect(() => {
    const rawSortOption = searchParams.get('sort')
    if (rawSortOption && rawSortOption !== sortOption) {
      updateSearchUrl(searchTerm, sortOption, 'replace')
    }
  }, [searchParams, searchTerm, sortOption, updateSearchUrl])

  useEffect(() => {
    if (initialRequest.current) {
      initialRequest.current = false
      return
    }

    const controller = new AbortController()
    loadingController.current?.abort()
    loadingController.current = controller
    nextPage.current = 1
    setIsLoading(true)
    setHasLoadError(false)
    const params = new URLSearchParams({ page: '0', pageSize: `${CATALOG_PAGE_SIZE}`, q: queriedSearchTerm, sort: sortOption })

    ;(async () => {
      try {
        const response = await fetch(`/api/catalog?${params}`, { signal: controller.signal })
        if (controller.signal.aborted) {
          return
        }
        if (!response.ok) {
          throw new Error(`Catalog request failed with status ${response.status}`)
        }
        const result = (await response.json()) as CatalogApiResponse
        setRepos(result.repos)
        setPluginsCount(result.pluginsCount)
        setTotal(result.total)
        setHasMore(result.hasMore)
      } catch {
        if (!controller.signal.aborted) {
          setHasLoadError(true)
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      }
    })()

    return () => {
      controller.abort()
      if (loadingController.current === controller) {
        loadingController.current = null
      }
    }
  }, [queriedSearchTerm, sortOption])

  const loadMore = useCallback(async () => {
    if (isLoading || !hasMore) {
      return
    }

    const controller = new AbortController()
    loadingController.current?.abort()
    loadingController.current = controller
    setIsLoading(true)
    const params = new URLSearchParams({
      page: `${nextPage.current}`,
      pageSize: `${CATALOG_PAGE_SIZE}`,
      q: queriedSearchTerm,
      sort: sortOption,
    })

    try {
      const response = await fetch(`/api/catalog?${params}`, { signal: controller.signal })
      if (controller.signal.aborted) {
        return
      }
      if (!response.ok) {
        throw new Error(`Catalog request failed with status ${response.status}`)
      }
      const result = (await response.json()) as CatalogApiResponse
      setRepos((currentRepos) => [...currentRepos, ...result.repos])
      setHasMore(result.hasMore)
      nextPage.current += 1
    } catch {
      if (!controller.signal.aborted) {
        setHasLoadError(true)
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false)
      }
    }
  }, [hasMore, isLoading, queriedSearchTerm, sortOption])

  useEffect(() => {
    window.sessionStorage.setItem('last-search-url', `${window.location.pathname}${window.location.search}`)
  }, [])

  useEffect(() => {
    const urlSearchTerm = searchParams.get('q') ?? ''
    setSearchTerm(urlSearchTerm)
    setQueriedSearchTerm(urlSearchTerm)
    setSortOption(parseSortOption(searchParams.get('sort')))
    window.sessionStorage.setItem('last-search-url', `${pathname}${searchParams.size > 0 ? `?${searchParams}` : ''}`)
  }, [pathname, searchParams])

  return (
    <>
      <SearchControls
        filteredPluginCount={pluginsCount}
        filteredRepoCount={total}
        onSearchChange={handleSearchChange}
        onSortChange={handleSortChange}
        searchTerm={searchTerm}
        sortOption={sortOption}
      />
      <RepoList hasLoadError={hasLoadError} hasMore={hasMore} isLoading={isLoading} onLoadMore={loadMore} sortedRepos={[...repos]} />
    </>
  )
}
