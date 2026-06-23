'use client'

import { useCallback, useState } from 'react'
import type { RepoSearchResult, SortOption } from '../../lib/repoSearch.ts'
import { RepoList } from './RepoList.tsx'
import { SearchControls } from './SearchControls.tsx'

interface SearchPageProps {
  initialResult: RepoSearchResult
}

export function SearchPage({ initialResult }: SearchPageProps) {
  const [result, setResult] = useState(initialResult)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadResults = useCallback(
    async ({ query, sortOption, page, append }: { query: string; sortOption: SortOption; page: number; append: boolean }) => {
      const params = new URLSearchParams({
        q: query,
        sort: sortOption,
        page: String(page),
        pageSize: String(initialResult.pageSize),
      })

      setLoadError(null)
      append ? setIsLoadingMore(true) : setIsLoading(true)

      try {
        const response = await fetch(`/api/repos/search?${params.toString()}`)
        if (!response.ok) {
          throw new Error('Failed to load repositories')
        }

        const nextResult = (await response.json()) as RepoSearchResult
        setResult((current) => ({
          ...nextResult,
          repos: append ? [...current.repos, ...nextResult.repos] : nextResult.repos,
        }))

        if (!append) {
          updateUrl(query, sortOption)
        }
      } catch {
        setLoadError('Failed to load repositories. Please try again later')
      } finally {
        append ? setIsLoadingMore(false) : setIsLoading(false)
      }
    },
    [initialResult.pageSize]
  )

  const handleSearchChange = useCallback(
    (query: string) => {
      loadResults({ query, sortOption: result.sortOption, page: 1, append: false })
    },
    [loadResults, result.sortOption]
  )

  const handleSortChange = useCallback(
    (sortOption: SortOption) => {
      loadResults({ query: result.query, sortOption, page: 1, append: false })
    },
    [loadResults, result.query]
  )

  const handleLoadMore = useCallback(() => {
    if (result.hasMore && !(isLoading || isLoadingMore)) {
      loadResults({ query: result.query, sortOption: result.sortOption, page: result.page + 1, append: true })
    }
  }, [isLoading, isLoadingMore, loadResults, result.hasMore, result.page, result.query, result.sortOption])

  return (
    <>
      <SearchControls
        filteredPluginCount={result.totalPluginCount}
        filteredRepoCount={result.totalRepoCount}
        isLoading={isLoading}
        onSearchChange={handleSearchChange}
        onSortChange={handleSortChange}
        searchTerm={result.query}
        sortOption={result.sortOption}
      />
      <RepoList
        hasLoadError={Boolean(loadError)}
        hasMore={result.hasMore}
        isLoadingMore={isLoadingMore}
        loadError={loadError}
        onLoadMore={handleLoadMore}
        sortedRepos={result.repos}
      />
    </>
  )
}

function updateUrl(query: string, sortOption: SortOption) {
  const params = new URLSearchParams()
  if (query) {
    params.set('q', query)
  }
  if (sortOption !== 'stars-desc') {
    params.set('sort', sortOption)
  }

  const nextUrl = params.toString() ? `/?${params.toString()}` : '/'
  window.history.replaceState(null, '', nextUrl)
}
