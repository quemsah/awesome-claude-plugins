import type { SizeRange } from './sizeRanges.js'

export const discoverySearchFamilies = [
  {
    queryFamily: 'marketplace_filename_path',
    expectedPath: undefined,
    buildQuery: ([min, max]: SizeRange) => `filename:marketplace.json path:.claude-plugin size:${min}..${max}`,
  },
  {
    queryFamily: 'marketplace_path_literal',
    expectedPath: '.claude-plugin/marketplace.json',
    buildQuery: ([min, max]: SizeRange) => `.claude-plugin/marketplace.json in:path size:${min}..${max}`,
  },
  {
    queryFamily: 'plugin_filename_path',
    expectedPath: '.claude-plugin/plugin.json',
    buildQuery: ([min, max]: SizeRange) => `filename:plugin.json path:.claude-plugin size:${min}..${max}`,
  },
] as const

export type DiscoveryQueryFamily = (typeof discoverySearchFamilies)[number]['queryFamily']
