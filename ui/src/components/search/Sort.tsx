import type { SortOption } from '../../lib/repoSearch.ts'

const sortOptions = [
  {
    value: 'stars-desc',
    label: 'Stars',
  },
  {
    value: 'forks-desc',
    label: 'Forks',
  },
  {
    value: 'plugins-desc',
    label: 'Plugins',
  },
] as const

interface SortProps {
  sortOption: SortOption
  onSortChange: (option: SortOption) => void
}

export function Sort({ sortOption, onSortChange }: SortProps) {
  return (
    <select
      aria-label="Sort by"
      className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 sm:w-48"
      name="sort"
      onChange={(event) => onSortChange(event.target.value as SortOption)}
      value={sortOption}
    >
      {sortOptions.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
