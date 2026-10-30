export const sortOptionValues = ['stars-desc', 'forks-desc', 'plugins-desc'] as const

export type SortOption = (typeof sortOptionValues)[number]
