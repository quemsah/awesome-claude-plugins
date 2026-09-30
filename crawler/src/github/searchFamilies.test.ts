import { expect, it } from 'vitest'
import { discoverySearchFamilies } from './searchFamilies.js'

it('builds the three exact discovery queries in stable order', () => {
  expect(discoverySearchFamilies.map(({ queryFamily }) => queryFamily)).toEqual([
    'marketplace_filename_path',
    'marketplace_path_literal',
    'claude_plugin_path',
  ])
  expect(discoverySearchFamilies.map(({ buildQuery }) => buildQuery([12, 34]))).toEqual([
    'filename:marketplace.json path:.claude-plugin size:12..34',
    '.claude-plugin/marketplace.json in:path size:12..34',
    'path:.claude-plugin size:12..34',
  ])
})
