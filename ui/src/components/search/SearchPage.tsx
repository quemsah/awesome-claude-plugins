'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFuzzySearch } from '../../hooks/useFuzzySearch.ts'
import { compareRepoQuality } from '../../lib/qualityScore.mjs'
import {
  filterReposByFacets,
  getCategoryOptions,
  getKeywordOptions,
  getLanguageOptions,
  getLifecycleOptions,
  getVerificationOptions,
} from '../../lib/repoFacets.mjs'
import { buildSearchUrl, parseSortOption } from '../../lib/searchState.ts'
import type { Repo } from '../../schemas/repo.schema.ts'
import { RepoList } from './RepoList.tsx'
import { SearchControls } from './SearchControls.tsx'
import type { SortOption } from './Sort.tsx'

interface SearchPageProps {
  initialRepos: Repo[]
  initialSearchTerm: string
  initialSortOption: SortOption
}

export function SearchPage({ initialRepos, initialSearchTerm, initialSortOption }: SearchPageProps) {
  const [sortOption, setSortOption] = useState<SortOption>(parseSortOption(initialSortOption))
  const [searchTerm, setSearchTerm] = useState(initialSearchTerm)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [keywordFilter, setKeywordFilter] = useState('')
  const [verificationFilter, setVerificationFilter] = useState('')
  const [lifecycleFilter, setLifecycleFilter] = useState('')
  const [languageFilter, setLanguageFilter] = useState('')

  const searchMatchedRepos = useFuzzySearch(initialRepos, searchTerm)
  const categoryOptions = useMemo(() => getCategoryOptions(searchMatchedRepos), [searchMatchedRepos])
  const keywordOptions = useMemo(() => getKeywordOptions(searchMatchedRepos), [searchMatchedRepos])
  const verificationOptions = useMemo(() => getVerificationOptions(searchMatchedRepos), [searchMatchedRepos])
  const lifecycleOptions = useMemo(() => getLifecycleOptions(searchMatchedRepos), [searchMatchedRepos])
  const languageOptions = useMemo(() => getLanguageOptions(searchMatchedRepos), [searchMatchedRepos])
  const filteredRepos = useMemo(
    () =>
      filterReposByFacets(searchMatchedRepos, {
        category: categoryFilter,
        keyword: keywordFilter,
        verification: verificationFilter,
        lifecycle: lifecycleFilter,
        language: languageFilter,
      }) as Repo[],
    [categoryFilter, keywordFilter, verificationFilter, lifecycleFilter, languageFilter, searchMatchedRepos]
  )
  const hasActiveFilters = Boolean(categoryFilter || keywordFilter || verificationFilter || lifecycleFilter || languageFilter)

  const sortedRepos = useMemo(
    () =>
      [...filteredRepos].sort((a, b) => {
        switch (sortOption) {
          case 'quality-desc':
            return compareRepoQuality(a, b)
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

  const clearAllFilters = useCallback(() => {
    setCategoryFilter('')
    setKeywordFilter('')
    setVerificationFilter('')
    setLifecycleFilter('')
    setLanguageFilter('')
  }, [])

  useEffect(() => {
    updateSearchUrl(searchTerm, sortOption, 'replace')
  }, [searchTerm, sortOption, updateSearchUrl])

  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search)
      setSearchTerm(params.get('q') ?? '')
      setSortOption(parseSortOption(params.get('sort')))
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  return (
    <>
      <SearchControls
        categoryFilter={categoryFilter}
        categoryOptions={categoryOptions}
        filteredPluginCount={filteredPluginCount}
        filteredRepoCount={filteredRepos.length}
        hasActiveFilters={hasActiveFilters}
        keywordFilter={keywordFilter}
        keywordOptions={keywordOptions}
        languageFilter={languageFilter}
        languageOptions={languageOptions}
        lifecycleFilter={lifecycleFilter}
        lifecycleOptions={lifecycleOptions}
        onCategoryChange={setCategoryFilter}
        onClearFilters={clearAllFilters}
        onKeywordChange={setKeywordFilter}
        onLanguageChange={setLanguageFilter}
        onLifecycleChange={setLifecycleFilter}
        onSearchChange={handleSearchChange}
        onSortChange={handleSortChange}
        onVerificationChange={setVerificationFilter}
        searchTerm={searchTerm}
        sortOption={sortOption}
        verificationFilter={verificationFilter}
        verificationOptions={verificationOptions}
      />
      <RepoList
        activeFilterSummary={getActiveFilterSummary(
          categoryFilter,
          categoryOptions,
          keywordFilter,
          keywordOptions,
          verificationFilter,
          verificationOptions,
          lifecycleFilter,
          lifecycleOptions,
          languageFilter,
          languageOptions
        )}
        hasLoadError={initialRepos.length === 0}
        onClearFilters={clearAllFilters}
        sortedRepos={sortedRepos}
        sortOption={sortOption}
      />
    </>
  )
}

function getActiveFilterSummary(
  categoryFilter: string,
  categoryOptions: FacetOption[],
  keywordFilter: string,
  keywordOptions: FacetOption[],
  verificationFilter: string,
  verificationOptions: FacetOption[],
  lifecycleFilter: string,
  lifecycleOptions: FacetOption[],
  languageFilter: string,
  languageOptions: FacetOption[]
): string {
  const parts: string[] = []

  if (categoryFilter) {
    const found = categoryOptions.find((o) => o.value === categoryFilter)
    if (found) parts.push(`Category: ${found.label}`)
  }
  if (keywordFilter) {
    const found = keywordOptions.find((o) => o.value === keywordFilter)
    if (found) parts.push(`Keyword: ${found.label}`)
  }
  if (verificationFilter) {
    const found = verificationOptions.find((o) => o.value === verificationFilter)
    if (found) parts.push(`Status: ${found.label}`)
  }
  if (lifecycleFilter) {
    const found = lifecycleOptions.find((o) => o.value === lifecycleFilter)
    if (found) parts.push(`Lifecycle: ${found.label}`)
  }
  if (languageFilter) {
    const found = languageOptions.find((o) => o.value === languageFilter)
    if (found) parts.push(`Language: ${found.label}`)
  }

  return parts.join(', ')
}

interface FacetOption {
  value: string
  label: string
  count: number
}
