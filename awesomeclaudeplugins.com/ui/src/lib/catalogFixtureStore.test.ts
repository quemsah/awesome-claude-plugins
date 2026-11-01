import { fileURLToPath } from 'node:url'
import { PublishedReposArraySchema } from '@awesome-claude-plugins/catalog-contract'
import { expect, it, vi } from 'vitest'

it('loads an isolated catalog file without replacing the checked-in snapshot', async () => {
  const key = Symbol.for('awesome-claude-plugins.catalog')
  const holder = globalThis as unknown as Record<symbol, unknown>
  const previous = holder[key]
  try {
    delete holder[key]
    vi.stubEnv('CATALOG_DATA_PATH', fileURLToPath(new URL('../../tests/e2e/fixtures/standalone-repos.json', import.meta.url)))
    const { getCatalog } = await vi.importActual<typeof import('./catalogStore.ts')>('./catalogStore.ts')
    const repos = PublishedReposArraySchema.parse(getCatalog())
    expect(repos).toHaveLength(2)
    expect(repos.map((repo) => repo.repo_name)).toEqual(['capsule', 'market-hub'])
    expect(repos[0].manifest_kind).toBe('standalone-plugin')
    expect(getCatalog()).toBe(getCatalog())
  } finally {
    if (previous === undefined) delete holder[key]
    else holder[key] = previous
    vi.unstubAllEnvs()
  }
})
