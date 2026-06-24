import type { SortOption } from '../components/search/Sort.tsx'
import { sortOptionValues } from '../components/search/Sort.tsx'

export const defaultSortOption: SortOption = sortOptionValues[0]
export const validSortOptions: readonly SortOption[] = sortOptionValues

export function parseSortOption(value: string | null | undefined): SortOption {
  return validSortOptions.includes(value as SortOption) ? (value as SortOption) : defaultSortOption
}

export function buildSearchUrl(pathname: string, currentParams: string, state: { searchTerm: string; sortOption: SortOption }): string {
  const params = new URLSearchParams(currentParams)
  const query = state.searchTerm.trim()
  const sortOption = parseSortOption(state.sortOption)

  if (query) {
    params.set('q', query)
  } else {
    params.delete('q')
  }

  if (sortOption === defaultSortOption) {
    params.delete('sort')
  } else {
    params.set('sort', sortOption)
  }

  const queryString = params.toString()
  return queryString ? `${pathname}?${queryString}` : pathname
}
