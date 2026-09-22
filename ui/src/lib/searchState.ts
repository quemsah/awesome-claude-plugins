import { type SortOption, sortOptionValues } from './sortOptions.ts'

/**
 * Which catalog request is in flight: `append` extends the rendered list with the next page, while
 * `replace` discards it and starts over after a search or sort change. `null` means nothing is loading.
 */
export type PendingCatalogLoad = 'append' | 'replace' | null

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
