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
import { useFuzzySearch } from '../hooks/useFuzzySearch.ts'
import { trackValidationError } from '../lib/validation.ts'
import { type Repo, ReposArraySchema } from '../schemas/repo.schema.ts'

export default function Home() {
  const [repos, setRepos] = useState<Repo[]>([])
  const [loading, setLoading] = useState(true)
  const [sortOption, setSortOption] = useState<SortOption>('stars-desc')
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const response = await fetch(`/api/repos`)

        if (!response.ok) {
          const errorData = await response.json()
          console.error('API Error:', errorData)
          setRepos([])
          return
        }

        const data = await response.json()

        const validationResult = ReposArraySchema.safeParse(data)

        if (validationResult.success) {
          setRepos(validationResult.data)
        } else {
          console.error('Invalid data format: Validation failed')
          trackValidationError(validationResult.error, 'Repos Fetch')
          setRepos([])
        }
      } catch (error) {
        console.error('Failed to fetch repos:', error)
        setRepos([])
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const filteredRepos = useFuzzySearch(repos, searchTerm)

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

        <div className="mb-4 flex flex-col items-center justify-between gap-4 md:flex-row">
          <div className="flex w-full flex-col items-center gap-4 sm:w-auto sm:flex-row">
            <div className="relative w-full sm:w-48">
              <Search aria-hidden="true" className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform" />
              <Input
                aria-label="Search repositories"
                className="w-full pl-10"
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search repositories..."
                type="search"
                value={searchTerm}
              />
            </div>
            <div className="w-full sm:w-auto">
              <Sort onSortChange={setSortOption} sortOption={sortOption} />
            </div>
          </div>
          <div className="text-muted-foreground text-sm">
            {loading
              ? 'Loading...'
              : `${filteredPluginCount} ${filteredPluginCount === 1 ? 'plugin' : 'plugins'} available across ${filteredRepos.length} ${filteredRepos.length === 1 ? 'repository' : 'repositories'}`}
          </div>
        </div>

        {loading ? (
          <div aria-busy="true" aria-live="polite">
            <LoadingContent />
          </div>
        ) : sortedRepos.length > 0 ? (
          <div aria-live="polite">
            <LoadedContent repos={sortedRepos} sortOption={sortOption} />
          </div>
        ) : (
          <div className="py-8 text-center">
            <p className="text-muted-foreground">
              {repos.length === 0 ? 'Failed to load repositories. Please try again later.' : 'No repositories match your search.'}
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
