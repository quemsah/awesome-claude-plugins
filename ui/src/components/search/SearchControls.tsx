'use client'

import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useDebouncedCallback } from 'use-debounce'
import { Input } from '../ui/input.tsx'
import { Sort, type SortOption } from './Sort.tsx'

interface FacetOption {
  value: string
  label: string
  count: number
}

interface SearchControlsProps {
  searchTerm: string
  onSearchChange: (value: string) => void
  sortOption: SortOption
  onSortChange: (option: SortOption) => void
  filteredPluginCount: number
  filteredRepoCount: number
  categoryFilter: string
  categoryOptions: FacetOption[]
  hasActiveFilters: boolean
  keywordFilter: string
  keywordOptions: FacetOption[]
  onCategoryChange: (value: string) => void
  onClearFilters: () => void
  onKeywordChange: (value: string) => void
}

export function SearchControls({
  searchTerm,
  onSearchChange,
  sortOption,
  onSortChange,
  filteredPluginCount,
  filteredRepoCount,
  categoryFilter,
  categoryOptions,
  hasActiveFilters,
  keywordFilter,
  keywordOptions,
  onCategoryChange,
  onClearFilters,
  onKeywordChange,
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
        <div className="relative w-full sm:w-48">
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
        <select
          aria-label="Filter by category"
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs sm:w-56"
          onChange={(event) => onCategoryChange(event.target.value)}
          value={categoryFilter}
        >
          <option value="">All categories</option>
          {categoryOptions.map((option) => (
            <option disabled={option.count === 0} key={option.value} value={option.value}>
              {option.label} ({option.count})
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by keyword"
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs sm:w-44"
          onChange={(event) => onKeywordChange(event.target.value)}
          value={keywordFilter}
        >
          <option value="">All keywords</option>
          {keywordOptions.map((option) => (
            <option disabled={option.count === 0} key={option.value} value={option.value}>
              {option.label} ({option.count})
            </option>
          ))}
        </select>
        {hasActiveFilters ? (
          <button
            className="text-muted-foreground text-sm underline-offset-4 hover:text-foreground hover:underline"
            onClick={onClearFilters}
            type="button"
          >
            Clear filters
          </button>
        ) : null}
      </div>
      <div className="text-center text-muted-foreground text-sm md:text-right">
        {`${filteredPluginCount} ${filteredPluginCount === 1 ? 'plugin' : 'plugins'} available across ${filteredRepoCount} ${filteredRepoCount === 1 ? 'repository' : 'repositories'}`}
      </div>
    </section>
  )
}
