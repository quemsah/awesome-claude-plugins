'use client'

import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Header } from '../components/common/Header.tsx'
import { LoadedContent } from '../components/search/LoadedContent.tsx'
import { LoadingContent } from '../components/search/LoadingContent.tsx'
import { Sort, type SortOption } from '../components/search/Sort.tsx'
import StructuredData from '../components/search/StructuredData.tsx'
import { TitleSection } from '../components/search/TitleSection.tsx'
import { Input } from '../components/ui/input.tsx'
import type { Repo } from './types/repo.type.ts'

export default function Home() {
  const [repos, setRepos] = useState<Repo[]>([])
  const [loading, setLoading] = useState(true)
  const [sortOption, setSortOption] = useState<SortOption>('stars-desc')
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const response = await fetch(`/api/repos`)
        const allRepos = (await response.json()) as Repo[]
        setRepos(allRepos)
      } catch (error) {
        console.error('Failed to fetch repos:', error)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const filteredRepos = useMemo(
    () =>
      repos.filter((repo) => {
        if (!searchTerm) return true

        const searchLower = searchTerm.toLowerCase()
        const nameMatch = repo.repo_name?.toLowerCase().includes(searchLower) ?? false
        const descriptionMatch = repo.description?.toLowerCase().includes(searchLower) ?? false

        return nameMatch || descriptionMatch
      }),
    [repos, searchTerm]
  )

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
    <main className="min-h-screen bg-background">
      <StructuredData />
      <Header />
      <div className="container mx-auto px-4 py-8">
        <TitleSection />

        <div className="flex flex-col sm:flex-row justify-between items-center mb-4 gap-4">
          <div className="flex items-center gap-4">
            <div className="relative w-[180px]">
              <Search aria-hidden="true" className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4" />
              <Input
                aria-label="Search repositories"
                className="pl-10"
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search repositories..."
                type="search"
                value={searchTerm}
              />
            </div>
            <Sort onSortChange={setSortOption} sortOption={sortOption} />
          </div>
          <div className="text-sm text-muted-foreground">
            {loading
              ? 'Loading...'
              : `${filteredPluginCount} ${filteredPluginCount === 1 ? 'plugin' : 'plugins'} available across ${filteredRepos.length} ${filteredRepos.length === 1 ? 'repository' : 'repositories'}`}
          </div>
        </div>

        {loading ? (
          <div aria-busy="true" aria-live="polite">
            <LoadingContent />
          </div>
        ) : (
          <div aria-live="polite">
            <LoadedContent repos={sortedRepos} sortOption={sortOption} />
          </div>
        )}
      </div>
    </main>
  )
}
