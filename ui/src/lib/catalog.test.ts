/** biome-ignore-all lint/style/useNamingConvention: Test assertion mirrors catalog field names. */

import { describe, expect, it } from 'vitest'
import { searchCatalogRepos } from './catalog.ts'

describe('searchCatalogRepos', () => {
  it('keeps review-needed canonical records discoverable', () => {
    const results = searchCatalogRepos('lean-playground', 'stars-desc')

    expect(results.repos).toEqual(expect.arrayContaining([expect.objectContaining({ owner: 'todorkolev', repo_name: 'lean-playground' })]))
  })
})
