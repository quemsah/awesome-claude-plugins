/** biome-ignore-all lint/style/useNamingConvention: Test assertion mirrors catalog field names. */

import { describe, expect, it } from 'vitest'
import { type CatalogRepo, getCanonicalCatalogRepos, searchCatalogRepos } from './catalog.ts'
import { createFuseIndex } from './fuzzySearch.ts'

function repoKey(repo: CatalogRepo) {
  return `${repo.owner}/${repo.repo_name}`
}

function fuzzyScores(query: string) {
  return new Map(
    createFuseIndex(getCanonicalCatalogRepos())
      .search(query)
      .map((result) => [repoKey(result.item), result.score ?? Number.POSITIVE_INFINITY])
  )
}

function pluginSignal(repo: CatalogRepo) {
  return (repo.plugins_count ?? 0) * Math.log10((repo.stargazers_count ?? 0) + 10)
}

describe('searchCatalogRepos', () => {
  it('keeps review-needed canonical records discoverable', () => {
    const results = searchCatalogRepos('lean-playground', 'stars-desc')

    expect(results.repos).toEqual(expect.arrayContaining([expect.objectContaining({ owner: 'todorkolev', repo_name: 'lean-playground' })]))
  })

  it('does not let one sort order leak into the next request for the same query', () => {
    const starsBefore = searchCatalogRepos('claude', 'stars-desc').repos

    searchCatalogRepos('claude', 'forks-desc')
    searchCatalogRepos('claude', 'plugins-desc')

    expect(searchCatalogRepos('claude', 'stars-desc').repos).toEqual(starsBefore)
  })

  it('uses the selected metric before fuzzy relevance for searched results', () => {
    const query = 'claude'
    const pageSize = 200

    const stars = searchCatalogRepos(query, 'stars-desc', 0, pageSize).repos
    const forks = searchCatalogRepos(query, 'forks-desc', 0, pageSize).repos
    const plugins = searchCatalogRepos(query, 'plugins-desc', 0, pageSize).repos

    for (let index = 1; index < stars.length; index += 1) {
      expect(stars[index - 1].stargazers_count ?? 0).toBeGreaterThanOrEqual(stars[index].stargazers_count ?? 0)
    }
    for (let index = 1; index < forks.length; index += 1) {
      expect(forks[index - 1].forks_count ?? 0).toBeGreaterThanOrEqual(forks[index].forks_count ?? 0)
    }
    for (let index = 1; index < plugins.length; index += 1) {
      expect(pluginSignal(plugins[index - 1])).toBeGreaterThanOrEqual(pluginSignal(plugins[index]))
    }
  })

  it('uses fuzzy relevance only after the selected sort keys tie', () => {
    const query = 'claude'
    const scores = fuzzyScores(query)
    const pageSize = 500

    const cases = [
      {
        repos: searchCatalogRepos(query, 'stars-desc', 0, pageSize).repos,
        keys: (repo: CatalogRepo) => [repo.stargazers_count ?? 0, repo.description?.trim() ? 1 : 0],
      },
      {
        repos: searchCatalogRepos(query, 'forks-desc', 0, pageSize).repos,
        keys: (repo: CatalogRepo) => [repo.forks_count ?? 0],
      },
      {
        repos: searchCatalogRepos(query, 'plugins-desc', 0, pageSize).repos,
        keys: (repo: CatalogRepo) => [pluginSignal(repo), repo.plugins_count ?? 0],
      },
    ]

    for (const { repos, keys } of cases) {
      let sawTie = false
      for (let index = 1; index < repos.length; index += 1) {
        const left = repos[index - 1]
        const right = repos[index]
        if (JSON.stringify(keys(left)) !== JSON.stringify(keys(right))) continue

        sawTie = true
        expect(scores.get(repoKey(left)) ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
          scores.get(repoKey(right)) ?? Number.POSITIVE_INFINITY
        )
      }
      expect(sawTie).toBe(true)
    }
  })
})
