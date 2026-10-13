export const sortOptionValues = ['stars-desc', 'forks-desc', 'plugins-desc', 'updated-desc', 'created-desc'] as const

export type SortOption = (typeof sortOptionValues)[number]
