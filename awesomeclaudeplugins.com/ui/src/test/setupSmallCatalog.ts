import { vi } from 'vitest'

// The real catalog is now loaded by catalogStore.ts via readFileSync, so a JSON import
// alias no longer substitutes unit test data. Mock the store in unit tests only.
vi.mock('../lib/catalogStore.ts', async () => {
  const { default: fixtureRepos } = await import('./fixtures/repos.json')
  return { getCatalog: () => fixtureRepos }
})
