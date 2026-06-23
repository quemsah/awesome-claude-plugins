'use client'

import { Search } from 'lucide-react'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { useDebouncedCallback } from 'use-debounce'
import type { SortOption } from '../../lib/repoSearch.ts'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/input.tsx'
import { Sort } from './Sort.tsx'

interface SearchControlsProps {
  searchTerm: string
  onSearchChange: (value: string) => void
  sortOption: SortOption
  onSortChange: (option: SortOption) => void
  filteredPluginCount: number
  filteredRepoCount: number
  isLoading: boolean
}

export function SearchControls({
  searchTerm,
  onSearchChange,
  sortOption,
  onSortChange,
  filteredPluginCount,
  filteredRepoCount,
  isLoading,
}: SearchControlsProps) {
  const [localSearchTerm, setLocalSearchTerm] = useState(searchTerm)

  useEffect(() => {
    setLocalSearchTerm(searchTerm)
  }, [searchTerm])

  const debouncedSearch = useDebouncedCallback((value: string) => {
    onSearchChange(value)
  }, 100)

  const handleSearchChange = (value: string) => {
    setLocalSearchTerm(value)
    debouncedSearch(value)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSearchChange(localSearchTerm)
  }

  return (
    <section aria-label="Repository search and filtering" className="mb-6 flex flex-col items-center justify-between gap-4 md:flex-row">
      <form action="/" className="flex w-full flex-col items-center gap-4 sm:w-auto sm:flex-row" method="get" onSubmit={handleSubmit}>
        <div className="relative w-full sm:w-48">
          <Search aria-hidden="true" className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform" />
          <Input
            aria-label="Search repositories"
            className="w-full pl-10"
            name="q"
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search repositories..."
            type="search"
            value={localSearchTerm}
          />
        </div>
        <div className="w-full sm:w-auto">
          <Sort onSortChange={onSortChange} sortOption={sortOption} />
        </div>
        <Button className="w-full sm:w-auto" type="submit" variant="outline">
          <Search aria-hidden="true" className="h-4 w-4" />
          Search
        </Button>
      </form>
      <div className="text-center text-muted-foreground text-sm md:text-right">
        {isLoading
          ? 'Loading repositories...'
          : `${filteredPluginCount} ${filteredPluginCount === 1 ? 'plugin' : 'plugins'} available across ${filteredRepoCount} ${filteredRepoCount === 1 ? 'repository' : 'repositories'}`}
      </div>
    </section>
  )
}
