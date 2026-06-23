'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFuzzySearch } from '../../hooks/useFuzzySearch.ts'
import { buildSearchUrl, parseSortOption } from '../../lib/searchState.mjs'
import type { Repo } from '../../schemas/repo.schema.ts'
import { RepoList } from './RepoList.tsx'
import { SearchControls } from './SearchControls.tsx'
import type { SortOption } from './Sort.tsx'

interface SearchPageProps {
  initialRepos: Repo[]
  initialSearchTerm: string
  initialSortOption: string
}

export function SearchPage({ initialRepos, initialSearchTerm, initialSortOption }: SearchPageProps) {
  const [sortOption, setSortOption] = useState<SortOption>(parseSortOption(initialSortOption) as SortOption)
  const [searchTerm, setSearchTerm] = useState(initialSearchTerm)

  const filteredRepos = useFuzzySearch(initialRepos, searchTerm)

  const sortedRepos = useMemo(
    () =>
      [...filteredRepos].sort((a, b) => {
        switch (sortOption) {
          case 'stars-desc':
            return (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0)
          case 'forks-desc':
            return (b.forks_count ?? 0) - (a.forks_count ?? 0)
          case 'plugins-desc':
            return (b.plugins_count ?? 0) - (a.plugins_count ?? 0)
          default:
            return 0
        }
      }),
    [filteredRepos, sortOption]
  )

  const filteredPluginCount = useMemo(() => filteredRepos.reduce((total, repo) => total + (repo.plugins_count || 0), 0), [filteredRepos])

  const updateSearchUrl = useCallback((nextSearchTerm: string, nextSortOption: SortOption, mode: 'push' | 'replace' = 'push') => {
    const currentUrl = `${window.location.pathname}${window.location.search}`
    const nextUrl = buildSearchUrl(window.location.pathname, window.location.search, {
      searchTerm: nextSearchTerm,
      sortOption: nextSortOption,
    })

    if (nextUrl !== currentUrl) {
      window.history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', nextUrl)
    }
  }, [])

  const handleSearchChange = useCallback(
    (nextSearchTerm: string) => {
      setSearchTerm(nextSearchTerm)
      updateSearchUrl(nextSearchTerm, sortOption)
    },
    [sortOption, updateSearchUrl]
  )

  const handleSortChange = useCallback(
    (nextSortOption: SortOption) => {
      setSortOption(nextSortOption)
      updateSearchUrl(searchTerm, nextSortOption)
    },
    [searchTerm, updateSearchUrl]
  )

  useEffect(() => {
    updateSearchUrl(searchTerm, sortOption, 'replace')
  }, [searchTerm, sortOption, updateSearchUrl])

  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search)
      setSearchTerm(params.get('q') ?? '')
      setSortOption(parseSortOption(params.get('sort')) as SortOption)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  return (
    <>
      <SearchControls
        filteredPluginCount={filteredPluginCount}
        filteredRepoCount={filteredRepos.length}
        onSearchChange={handleSearchChange}
        onSortChange={handleSortChange}
        searchTerm={searchTerm}
        sortOption={sortOption}
      />
      <RepoList hasLoadError={initialRepos.length === 0} sortedRepos={sortedRepos} sortOption={sortOption} />
    </>
  )
}
