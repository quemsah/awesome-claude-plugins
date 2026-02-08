'use client'

import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useDebouncedCallback } from 'use-debounce'
import { Input } from '../ui/input.tsx'
import { Sort, type SortOption } from './Sort.tsx'

interface SearchControlsProps {
  searchTerm: string
  onSearchChange: (value: string) => void
  sortOption: SortOption
  onSortChange: (option: SortOption) => void
  filteredPluginCount: number
  filteredRepoCount: number
}

export function SearchControls({
  searchTerm,
  onSearchChange,
  sortOption,
  onSortChange,
  filteredPluginCount,
  filteredRepoCount,
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

  return (
    <section aria-label="Repository search and filtering" className="mb-6 flex flex-col items-center justify-between gap-4 md:flex-row">
      <div className="flex w-full flex-col items-center gap-4 sm:w-auto sm:flex-row">
        <div className="relative w-full sm:w-64 lg:w-80">
          <Search aria-hidden="true" className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform" />
          <Input
            aria-label="Search repositories"
            className="w-full pl-10"
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search repositories..."
            type="search"
            value={localSearchTerm}
          />
        </div>
        <div className="w-full sm:w-auto">
          <Sort onSortChange={onSortChange} sortOption={sortOption} />
        </div>
      </div>
      <div className="text-center text-muted-foreground text-sm md:text-right">
        {`${filteredPluginCount} ${filteredPluginCount === 1 ? 'plugin' : 'plugins'} available across ${filteredRepoCount} ${filteredRepoCount === 1 ? 'repository' : 'repositories'}`}
      </div>
    </section>
  )
}
