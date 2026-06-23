export const defaultSortOption = 'stars-desc'
export const validSortOptions = ['stars-desc', 'forks-desc', 'plugins-desc']

export function parseSortOption(value) {
  return validSortOptions.includes(value) ? value : defaultSortOption
}

export function buildSearchUrl(pathname, currentParams, state) {
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
