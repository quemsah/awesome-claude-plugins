/** biome-ignore-all lint/style/useNamingConvention: Test assertion mirrors catalog field names. */

import { describe, expect, it } from 'vitest'
import { type CatalogRepo, compareCatalogRepos, formatCatalogRepo, getCanonicalCatalogRepos, searchCatalogRepos } from './catalog.ts'
import { createFuseIndex } from './fuzzySearch.ts'
import { isArchivedRepo } from './repoMetadata.ts'

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
  it('uses the small catalog fixture in unit tests', () => {
    const repos = getCanonicalCatalogRepos()

    expect(repos.length).toBeLessThan(100)
    expect(repos).toEqual(expect.arrayContaining([expect.objectContaining({ owner: 'ykdojo', repo_name: 'claude-code-tips' })]))
    expect(
      repos.filter((repo) => repo.owner?.toLowerCase() === 'fixture-org' && repo.repo_name?.toLowerCase() === 'claude-plugin-00')
    ).toHaveLength(1)
  })

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

describe('formatCatalogRepo', () => {
  it('formats plugin names and descriptions when plugins array is provided', () => {
    const rawRepo: CatalogRepo = {
      id: 999,
      owner: 'example',
      repo_name: 'repo',
      description: 'Test repository',
      stargazers_count: 10,
      forks_count: 2,
      subscribers_count: 1,
      plugins_count: 1,
      plugins: [{ name: 'my-plugin', description: 'Plugin description' }],
    }

    const formatted = formatCatalogRepo(rawRepo)
    expect(formatted.plugins).toEqual([{ name: 'my-plugin', description: 'Plugin description' }])
  })

  it('normalizes single plugin metadata fields into plugins array', () => {
    const rawRepo: CatalogRepo = {
      id: 999,
      owner: 'example',
      repo_name: 'repo',
      description: 'Test repository',
      stargazers_count: 10,
      forks_count: 2,
      subscribers_count: 1,
      plugins_count: 1,
      plugin_name: 'single-plugin',
      plugin_description: 'Single description',
    }

    const formatted = formatCatalogRepo(rawRepo)
    expect(formatted.plugins).toEqual([{ name: 'single-plugin', description: 'Single description' }])
  })

  it('leaves repos without plugin metadata unchanged without adding empty plugins', () => {
    const rawRepo: CatalogRepo = {
      id: 999,
      owner: 'example',
      repo_name: 'repo',
      description: 'Test repository',
      stargazers_count: 10,
      forks_count: 2,
      subscribers_count: 1,
      plugins_count: null,
    }

    const formatted = formatCatalogRepo(rawRepo)
    expect(formatted.plugins).toBeUndefined()
  })
})

describe('archived-aware sorting', () => {
  it('recognizes archived repositories from either source', () => {
    const repo = { description: '[Archived] retired', archived: null } as CatalogRepo
    expect(isArchivedRepo(repo)).toBe(true)
    expect(isArchivedRepo({ ...repo, description: 'active', archived: true })).toBe(true)
    expect(isArchivedRepo({ ...repo, description: 'active', archived: false })).toBe(false)
  })
  it('accepts both freshness sort modes with missing metadata', () => {
    expect(searchCatalogRepos('claude', 'updated-desc').repos.length).toBeGreaterThan(0)
    expect(searchCatalogRepos('claude', 'created-desc').repos.length).toBeGreaterThan(0)
  })
})

describe('metadata sorting on representative records', () => {
  const base = {
    id: 1,
    owner: 'demo',
    repo_name: 'a',
    description: 'Active',
    stargazers_count: 1,
    forks_count: 0,
    subscribers_count: 0,
    plugins_count: 1,
  } satisfies CatalogRepo
  it('sorts missing timestamps last', () => {
    const recent = { ...base, pushed_at: '2026-10-30T00:00:00.000Z' }
    const unknown = { ...base, id: 2, pushed_at: null }
    expect(compareCatalogRepos(recent, unknown, 'updated-desc')).toBeLessThan(0)
    expect(compareCatalogRepos(unknown, recent, 'updated-desc')).toBeGreaterThan(0)
  })
  it('uses first catalog discovery date rather than GitHub creation date', () => {
    const recent = { ...base, catalog_added_at: '2026-10-30T00:00:00.000Z' }
    const older = { ...base, catalog_added_at: '2025-01-01T00:00:00.000Z' }
    expect(compareCatalogRepos(recent, older, 'created-desc')).toBeLessThan(0)
  })
  it('prefers active repositories even when an archived repository has more stars', () => {
    const archived = { ...base, archived: true, stargazers_count: 1000 }
    expect(compareCatalogRepos(base, archived, 'stars-desc')).toBeLessThan(0)
    expect(compareCatalogRepos(base, archived, 'updated-desc')).toBeLessThan(0)
    expect(isArchivedRepo({ ...base, description: '[Archived] stale text', archived: false })).toBe(false)
  })
})
