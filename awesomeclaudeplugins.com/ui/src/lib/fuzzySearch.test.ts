/** biome-ignore-all lint/style/useNamingConvention: Test fixture mirrors catalog field names. */

import { describe, expect, it } from 'vitest'
import type { Repo } from '../schemas/repo.schema.ts'
import { createCatalogSearchIndex } from './fuzzySearch.ts'
import { sortOptionValues } from './sortOptions.ts'

const baseRepo = {
  html_url: 'https://github.com/example/type-detector',
  stargazers_count: 10,
  forks_count: 1,
  subscribers_count: 1,
  description: 'Reports the types of incoming requests',
  owner: 'schema-sift',
  owner_url: 'https://github.com/owner-url-only',
  repo_name: 'type-detector',
  plugins_count: 2,
  id: 1,
} as const

describe('createCatalogSearchIndex', () => {
  it('searches every catalog field the index is configured with', () => {
    const index = createCatalogSearchIndex([baseRepo])
    expect(index.search('detector').matches).toHaveLength(1)
    expect(index.search('sift').matches).toHaveLength(1)
    expect(index.search('incoming requests').matches).toHaveLength(1)
  })

  it('does not search the URL columns', () => {
    const index = createCatalogSearchIndex([baseRepo])
    expect(index.search('example').matches).toHaveLength(0)
    expect(index.search('owner-url-only').matches).toHaveLength(0)
  })

  it('finds prefixes without broadening multi-word queries to unrelated terms', () => {
    const index = createCatalogSearchIndex([
      baseRepo,
      { ...baseRepo, id: 2, repo_name: 'unrelated', owner: 'other', description: 'incoming mail' },
    ])
    expect(index.search('detec').matches.map((result) => result.item.id)).toEqual([1])
    expect(index.search('incoming reque').matches.map((result) => result.item.id)).toEqual([1])
    expect(index.search('incoming requests').matches.map((result) => result.item.id)).toEqual([1])
    expect(index.search('!!!').matches).toEqual([])
  })

  it('distinguishes C++ and C# from ordinary c-prefix words', () => {
    const index = createCatalogSearchIndex([
      { ...baseRepo, id: 1, owner: 'cpp', repo_name: 'cpp-support', description: 'C++ language tools' },
      { ...baseRepo, id: 2, owner: 'csharp', repo_name: 'dotnet-support', description: 'C# language tools' },
      { ...baseRepo, id: 3, owner: 'claude', repo_name: 'code-support', description: 'Claude coding tools' },
      { ...baseRepo, id: 4, owner: 'math', repo_name: 'addition', description: 'foo+bar library' },
    ])
    expect(index.search('c++').matches.map((match) => match.item.id)).toEqual([1])
    expect(index.search('C#').matches.map((match) => match.item.id)).toEqual([2])
    expect(index.search('c?').total).toBe(0)
    expect(index.search('c*').total).toBe(0)
    expect(index.search('c').total).toBe(0)
    expect(index.search('foo+bar').matches.map((match) => match.item.id)).toEqual([4])
    expect(index.search('claude c').matches.map((match) => match.item.id)).toEqual([3])
  })

  it('keeps mixed symbolic identifiers and leading hashtags as whole FTS terms', () => {
    const index = createCatalogSearchIndex([
      { ...baseRepo, id: 1, repo_name: 'language-17', owner: 'cpp17', description: 'C++17 libraries' },
      { ...baseRepo, id: 2, repo_name: 'language-standard', owner: 'cpp', description: 'C++ libraries' },
      { ...baseRepo, id: 3, repo_name: 'hashtag-repo', owner: 'tags', description: '#devtools plugin' },
      { ...baseRepo, id: 4, repo_name: 'regular-repo', owner: 'tags', description: 'devtools plugin' },
    ])
    expect(index.search('C++17').matches.map((match) => match.item.id)).toEqual([1])
    expect(index.search('C++').matches.map((match) => match.item.id)).toEqual([1, 2])
    expect(index.search('#devtools').matches.map((match) => match.item.id)).toEqual([3])
    expect(index.search('devtools').matches.map((match) => match.item.id)).toEqual([4])
  })

  it('paginates matching rows in metric order with accurate totals and archived rows last', () => {
    const repos: Repo[] = [
      { ...baseRepo, id: 1, stargazers_count: 4, plugins_count: 2 },
      { ...baseRepo, id: 2, stargazers_count: 20, plugins_count: 3, archived: true },
      { ...baseRepo, id: 3, stargazers_count: 10, plugins_count: 5 },
      { ...baseRepo, id: 4, description: 'unrelated', repo_name: 'other', owner: 'other', plugins_count: 100 },
    ]
    const index = createCatalogSearchIndex(repos)
    const first = index.search('detector', 'stars-desc', 0, 2)
    const next = index.search('detector', 'stars-desc', 1, 2)
    expect(first.matches.map((match) => match.item.id)).toEqual([3, 1])
    expect(next.matches.map((match) => match.item.id)).toEqual([2])
    expect(first.total).toBe(3)
    expect(first.pluginsCount).toBe(10)
    expect(next.total).toBe(3)
    expect(index.search('detector', 'stars-desc', 10, 2)).toMatchObject({ matches: [], total: 3, pluginsCount: 10 })
  })

  it('keeps matches visible while typing a one-character final word', () => {
    const index = createCatalogSearchIndex([{ ...baseRepo, repo_name: 'claude-code' }])
    expect(index.search('claude c').matches.map((match) => match.item.id)).toEqual([1])
    expect(index.search('claude co').matches.map((match) => match.item.id)).toEqual([1])
    expect(index.search('c').total).toBe(0)
  })

  it.each(sortOptionValues)('ranks the whole tied metric group before paginating %s', (sort) => {
    const index = createCatalogSearchIndex([
      { ...baseRepo, id: 1, description: 'needle plus a long collection of unrelated words' },
      { ...baseRepo, id: 2, description: 'needle' },
      { ...baseRepo, id: 3, description: 'needle padding' },
    ])
    expect(index.search('needle', sort, 0, 1).matches.map((match) => match.item.id)).toEqual([2])
    expect(index.search('needle', sort, 1, 1).matches.map((match) => match.item.id)).toEqual([3])
    expect(index.search('needle', sort, 2, 1).matches.map((match) => match.item.id)).toEqual([1])
  })

  it('treats quotes and FTS operators as literal words', () => {
    const index = createCatalogSearchIndex([baseRepo])
    expect(index.search('"incoming requests"').matches).toHaveLength(1)
    expect(index.search('incoming OR nonexistent').total).toBe(0)
    expect(index.search('"* : ( )').total).toBe(0)
  })

  it('finds repositories by plugin summary names and descriptions', () => {
    const repo = {
      ...baseRepo,
      plugins: [{ name: 'uniqueweatherplugin', description: 'satellite forecast automation' }],
      plugin_summaries: [{ name: 'legacynameplugin', description: 'postal lookup workflow' }],
      plugin_name: 'standaloneplugin',
      plugin_description: 'unique documentation assistant',
    }
    const index = createCatalogSearchIndex([repo])
    expect(index.search('uniqueweatherplugin').matches).toHaveLength(1)
    expect(index.search('satellite forecast').matches).toHaveLength(1)
    expect(index.search('legacynameplugin').matches).toHaveLength(1)
    expect(index.search('postal lookup').matches).toHaveLength(1)
    expect(index.search('standaloneplugin').matches).toHaveLength(1)
    expect(index.search('documentation assistant').matches).toHaveLength(1)
  })
})
