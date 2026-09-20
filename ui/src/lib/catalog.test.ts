/** biome-ignore-all lint/style/useNamingConvention: Test assertion mirrors catalog field names. */

import { describe, expect, it } from 'vitest'
import { searchCatalogRepos } from './catalog.ts'

describe('searchCatalogRepos', () => {
  it('keeps review-needed canonical records discoverable', () => {
    const results = searchCatalogRepos('lean-playground', 'stars-desc')

    expect(results.repos).toEqual(expect.arrayContaining([expect.objectContaining({ owner: 'todorkolev', repo_name: 'lean-playground' })]))
  })

  it('repeats a cached query identically', () => {
    const first = searchCatalogRepos('claude', 'stars-desc', 1, 24)
    const second = searchCatalogRepos('claude', 'stars-desc', 1, 24)

    expect(second).toEqual(first)
  })

  it('does not let one sort order leak into the next request for the same query', () => {
    const starsBefore = searchCatalogRepos('claude', 'stars-desc').repos

    searchCatalogRepos('claude', 'forks-desc')
    searchCatalogRepos('claude', 'plugins-desc')

    expect(searchCatalogRepos('claude', 'stars-desc').repos).toEqual(starsBefore)
  })
})
