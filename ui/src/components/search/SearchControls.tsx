'use client'

import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useDebouncedCallback } from 'use-debounce'
import type { SortOption } from '../../lib/sortOptions.ts'
import { Input } from '../ui/input.tsx'
import { Sort } from './Sort.tsx'

const pluralRules = new Intl.PluralRules('en')

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

  useEffect(() => {
    if (window.location.hash === '#search') {
      document.querySelector<HTMLInputElement>('#search')?.focus()
    }
  }, [])

  const debouncedSearch = useDebouncedCallback((value: string) => {
    onSearchChange(value)
  }, 250)

  const handleSearchChange = (value: string) => {
    setLocalSearchTerm(value)
    debouncedSearch(value)
  }

  return (
    <section aria-label="Repository search and filtering" className="mb-6 flex flex-col items-center justify-between gap-4 md:flex-row">
      <div className="flex w-full flex-col items-center gap-4 sm:w-auto sm:flex-row">
        <div className="relative w-full max-w-xl">
          <Search aria-hidden="true" className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform" />
          <Input
            aria-keyshortcuts="Control+K Meta+K"
            aria-label="Search repositories"
            className="w-full pl-10"
            dir="auto"
            enterKeyHint="search"
            id="search"
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search repositories..."
            title="Press Cmd or Ctrl K to focus search"
            type="search"
            value={localSearchTerm}
          />
        </div>
        <div className="w-full sm:w-auto">
          <Sort onSortChange={onSortChange} sortOption={sortOption} />
        </div>
      </div>
      <div aria-atomic="true" aria-live="polite" className="text-center text-muted-foreground text-sm md:text-right" role="status">
        {`${filteredPluginCount} ${pluralize(filteredPluginCount, 'plugin', 'plugins')} available across ${filteredRepoCount} ${pluralize(filteredRepoCount, 'repository', 'repositories')}`}
      </div>
    </section>
  )
}

function pluralize(count: number, singular: string, plural: string): string {
  return pluralRules.select(count) === 'one' ? singular : plural
}
