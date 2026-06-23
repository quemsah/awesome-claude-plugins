'use client'

import { useMemo, useState } from 'react'
import { useFuzzySearch } from '../../hooks/useFuzzySearch.ts'
import { filterReposByFacets, getCategoryOptions, getKeywordOptions } from '../../lib/repoFacets.mjs'
import type { Repo } from '../../schemas/repo.schema.ts'
import { RepoList } from './RepoList.tsx'
import { SearchControls } from './SearchControls.tsx'
import type { SortOption } from './Sort.tsx'

interface SearchPageProps {
  initialRepos: Repo[]
}

export function SearchPage({ initialRepos }: SearchPageProps) {
  const [sortOption, setSortOption] = useState<SortOption>('stars-desc')
  const [searchTerm, setSearchTerm] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [keywordFilter, setKeywordFilter] = useState('')

  const searchMatchedRepos = useFuzzySearch(initialRepos, searchTerm)
  const categoryOptions = useMemo(() => getCategoryOptions(searchMatchedRepos), [searchMatchedRepos])
  const keywordOptions = useMemo(() => getKeywordOptions(searchMatchedRepos), [searchMatchedRepos])
  const filteredRepos = useMemo(
    () => filterReposByFacets(searchMatchedRepos, { category: categoryFilter, keyword: keywordFilter }) as Repo[],
    [categoryFilter, keywordFilter, searchMatchedRepos]
  )
  const hasActiveFilters = Boolean(categoryFilter || keywordFilter)

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
        onCategoryChange={setCategoryFilter}
        onClearFilters={() => {
          setCategoryFilter('')
          setKeywordFilter('')
        }}
        onKeywordChange={setKeywordFilter}
        onSearchChange={setSearchTerm}
        onSortChange={setSortOption}
        searchTerm={searchTerm}
        sortOption={sortOption}
      />
      <RepoList
        activeFilterSummary={getActiveFilterSummary(categoryFilter, keywordFilter, categoryOptions, keywordOptions)}
        hasLoadError={initialRepos.length === 0}
        onClearFilters={() => {
          setCategoryFilter('')
          setKeywordFilter('')
        }}
        sortedRepos={sortedRepos}
        sortOption={sortOption}
      />
    </>
  )
}

function getActiveFilterSummary(
  categoryFilter: string,
  keywordFilter: string,
  categoryOptions: FacetOption[],
  keywordOptions: FacetOption[]
) {
  return [
    categoryOptions.find((option) => option.value === categoryFilter)?.label,
    keywordOptions.find((option) => option.value === keywordFilter)?.label,
  ]
    .filter(Boolean)
    .join(' and ')
}

interface FacetOption {
  value: string
  label: string
  count: number
}
