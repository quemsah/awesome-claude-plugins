import type { SizeRange } from './sizeRanges.js'

export const discoverySearchFamilies = [
  {
    queryFamily: 'marketplace_filename_path',
    buildQuery: ([min, max]: SizeRange) => `filename:marketplace.json path:.claude-plugin size:${min}..${max}`,
  },
  {
    queryFamily: 'marketplace_path_literal',
    buildQuery: ([min, max]: SizeRange) => `.claude-plugin/marketplace.json in:path size:${min}..${max}`,
  },
] as const

export type DiscoveryQueryFamily = (typeof discoverySearchFamilies)[number]['queryFamily']
