/** biome-ignore-all lint/style/useNamingConvention: schema.org keys and GitHub API fields are both snake_case. */
import { describe, expect, it } from 'vitest'
import type { Repo } from '../schemas/repo.schema.ts'
import { getRepoStructuredData } from './repoStructuredData.ts'
import { createCatalogRepositorySnapshot } from './repositorySnapshot.ts'

const catalogRepo = {
  description: 'Kubernetes AI Toolchain Operator',
  forks_count: 1683,
  html_url: 'https://github.com/kaito-project/kaito',
  id: 4,
  owner: 'kaito-project',
  owner_url: 'https://github.com/kaito-project',
  plugins_count: 1,
  repo_name: 'kaito',
  stargazers_count: 1013,
  subscribers_count: 10,
} satisfies Repo

function nodeByType(nodes: Record<string, unknown>[], type: string): Record<string, unknown> | undefined {
  return nodes.find((node) => node['@type'] === type)
}

describe('getRepoStructuredData', () => {
  it('describes the repository without claiming an owner type the catalog never recorded', () => {
    const nodes = getRepoStructuredData(createCatalogRepositorySnapshot(catalogRepo))
    const sourceCode = nodeByType(nodes, 'SoftwareSourceCode')

    expect(sourceCode?.author).toEqual({
      name: 'kaito-project',
      url: 'https://github.com/kaito-project',
    })
    expect(nodes.some((node) => node['@type'] === 'Organization')).toBe(false)
  })

  it('leaves metadata GitHub is the only source of out of the description', () => {
    const sourceCode = nodeByType(getRepoStructuredData(createCatalogRepositorySnapshot(catalogRepo)), 'SoftwareSourceCode')

    expect(sourceCode).toMatchObject({
      codeRepository: 'https://github.com/kaito-project/kaito',
      description: 'Kubernetes AI Toolchain Operator',
      name: 'kaito',
    })
    expect(sourceCode).not.toHaveProperty('programmingLanguage')
    expect(sourceCode).not.toHaveProperty('license')
    expect(sourceCode).not.toHaveProperty('keywords')
    expect(sourceCode).not.toHaveProperty('dateCreated')
    expect(sourceCode).not.toHaveProperty('dateModified')
  })

  it('types the author as a person once GitHub reports the owner as a user', () => {
    const nodes = getRepoStructuredData({
      ...createCatalogRepositorySnapshot(catalogRepo),
      owner: { ...createCatalogRepositorySnapshot(catalogRepo).owner, type: 'User' },
    })

    expect(nodeByType(nodes, 'SoftwareSourceCode')?.author).toMatchObject({ '@type': 'Person' })
    expect(nodes.some((node) => node['@type'] === 'Organization')).toBe(false)
  })

  it('types the author as an organization and publishes it once GitHub reports that', () => {
    const snapshot = createCatalogRepositorySnapshot(catalogRepo)
    const nodes = getRepoStructuredData({ ...snapshot, owner: { ...snapshot.owner, type: 'Organization' } })

    expect(nodeByType(nodes, 'SoftwareSourceCode')?.author).toMatchObject({ '@type': 'Organization' })
    expect(nodeByType(nodes, 'Organization')).toMatchObject({
      name: 'kaito-project',
      sameAs: ['https://github.com/kaito-project'],
    })
  })

  it('keeps the breadcrumb trail that ends on the repository', () => {
    const breadcrumb = nodeByType(getRepoStructuredData(createCatalogRepositorySnapshot(catalogRepo)), 'BreadcrumbList')

    expect(breadcrumb?.itemListElement).toMatchObject([{ name: 'Home' }, { name: 'kaito' }])
  })
})
