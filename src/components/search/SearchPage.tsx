'use client'

import { useMemo, useState } from 'react'
import { useFuzzySearch } from '../../hooks/useFuzzySearch.ts'
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

  const filteredRepos = useFuzzySearch(initialRepos, searchTerm)

  const sortedRepos = useMemo(
    () =>
      [...filteredRepos].sort((a, b) => {
        switch (sortOption) {
          case 'stars-desc':
            return (b.stargazers_count || 0) - (a.stargazers_count || 0)
          case 'forks-desc':
            return (b.forks_count || 0) - (a.forks_count || 0)
          case 'plugins-desc':
            return (b.plugins_count || 0) - (a.plugins_count || 0)
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
        filteredPluginCount={filteredPluginCount}
        filteredRepoCount={filteredRepos.length}
        isLoading={false}
        onSearchChange={setSearchTerm}
        onSortChange={setSortOption}
        searchTerm={searchTerm}
        sortOption={sortOption}
      />
      <RepoList isLoading={false} repos={initialRepos} sortedRepos={sortedRepos} sortOption={sortOption} />
    </>
  )
}
