/** biome-ignore-all lint/style/useNamingConvention: Snapshot mirrors GitHub API field names. */
import { describe, expect, it } from 'vitest'
import type { Repo } from '../schemas/repo.schema.ts'
import { createCatalogRepositorySnapshot } from './repositorySnapshot.ts'

const catalogRepo = {
  description: 'A catalogued repository',
  forks_count: 815,
  html_url: 'https://github.com/example-owner/example-repo',
  id: 1,
  owner: 'example-owner',
  owner_url: 'https://github.com/example-owner',
  plugins_count: 1,
  repo_name: 'example-repo',
  stargazers_count: 10105,
  subscribers_count: 67,
} satisfies Repo

describe('createCatalogRepositorySnapshot', () => {
  it('carries the counts the catalog records', () => {
    const snapshot = createCatalogRepositorySnapshot(catalogRepo)

    expect(snapshot).toMatchObject({
      description: 'A catalogued repository',
      forks_count: 815,
      stargazers_count: 10105,
      subscribers_count: 67,
    })
  })

  it('leaves fields the catalog does not record unknown rather than inventing them', () => {
    const snapshot = createCatalogRepositorySnapshot(catalogRepo)

    expect(snapshot.open_issues_count).toBeNull()
    expect(snapshot.size).toBeNull()
    expect(snapshot.pushed_at).toBeNull()
    expect(snapshot.language).toBeNull()
    expect(snapshot.topics).toEqual([])
  })

  it('leaves the avatar unknown because the catalog does not record avatar URLs', () => {
    expect(createCatalogRepositorySnapshot(catalogRepo).owner.avatar_url).toBeNull()
  })

  it('reads marketplace manifests from the default branch without knowing its name', () => {
    expect(createCatalogRepositorySnapshot(catalogRepo).default_branch).toBe('HEAD')
  })
})
