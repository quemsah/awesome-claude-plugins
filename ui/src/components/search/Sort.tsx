import { Box, GitFork, Star } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.tsx'

export type SortOption = 'stars-desc' | 'forks-desc' | 'plugins-desc'

const sortOptions = [
  {
    value: 'stars-desc',
    label: 'Stars',
    icon: <Star className="mr-2 h-4 w-4" />,
  },
  {
    value: 'forks-desc',
    label: 'Forks',
    icon: <GitFork className="mr-2 h-4 w-4" />,
  },
  {
    value: 'plugins-desc',
    label: 'Plugins',
    icon: <Box className="mr-2 h-4 w-4" />,
  },
] as const

interface SortProps {
  sortOption: SortOption
  onSortChange: (option: SortOption) => void
}

export function Sort({ sortOption, onSortChange }: SortProps) {
  const selectedOption = sortOptions.find((option) => option.value === sortOption) || sortOptions[0]

  return (
    <Select onValueChange={(value: string) => onSortChange(value as SortOption)} value={sortOption}>
      <SelectTrigger aria-label="Sort by" className="w-full sm:w-48">
        <SelectValue>
          <span className="flex items-center">
            {selectedOption.icon}
            <span className="truncate">{selectedOption.label}</span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start">
        {sortOptions.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <span className="flex items-center">
              {option.icon}
              <span className="truncate">{option.label}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
