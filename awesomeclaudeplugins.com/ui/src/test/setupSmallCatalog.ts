import { vi } from 'vitest'
import type { Repo } from '../schemas/repo.schema.ts'

// The real catalog is now loaded by catalogStore.ts via readFileSync, so a JSON import
// alias no longer substitutes unit test data. Mock the store in unit tests only.
vi.mock('../lib/catalogStore.ts', async () => {
  const { default: fixtureRepos } = await import('./fixtures/repos.json')
  const repos = fixtureRepos as unknown as Repo[]
  return {
    getCatalog: () => repos,
    getRepoDetails: (id: number) => repos.find((r) => r.id === id) ?? null,
    hydrateCatalogRepo: <T extends { id: number }>(repo: T): T => {
      const found = repos.find((r) => r.id === repo.id)
      return (found ? { ...repo, ...found } : repo) as T
    },
    isSearchCatalogRepo: (_repo: unknown): boolean => false,
    readCatalogSearchFields: () => [],
  }
})
