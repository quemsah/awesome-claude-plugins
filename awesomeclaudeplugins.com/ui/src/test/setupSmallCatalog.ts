import { existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SnapshotInput } from '@awesome-claude-plugins/catalog-snapshot'
import { buildPublicCatalog } from '@awesome-claude-plugins/catalog-snapshot/build'
import { vi } from 'vitest'
import type { Repo } from '../schemas/repo.schema.ts'
import fixtureRepos from './fixtures/repos.json' with { type: 'json' }

const workerId = process.env.VITEST_POOL_ID ?? process.pid
const fixtureDbPath = join(tmpdir(), `vitest-catalog-fixture-${workerId}.sqlite`)
const fixtureManifestPath = join(tmpdir(), `vitest-catalog-fixture-${workerId}.manifest.json`)

if (!(existsSync(fixtureDbPath) && existsSync(fixtureManifestPath))) {
  const manifest = buildPublicCatalog(
    {
      records: fixtureRepos as unknown as SnapshotInput['records'],
      stats: [{ id: 1, date: '2026-03-01', size: fixtureRepos.length }],
      snapshotId: 'vitest-fixture',
    },
    fixtureDbPath
  )
  writeFileSync(fixtureManifestPath, JSON.stringify(manifest, null, 2), 'utf8')
}

process.env.CATALOG_SQLITE_PATH = fixtureDbPath
process.env.CATALOG_MANIFEST_PATH = fixtureManifestPath

vi.mock('../lib/catalogStore.ts', async () => {
  const repos = fixtureRepos as unknown as Repo[]
  return {
    getCatalog: () => repos,
    getRepoDetails: (id: number) => repos.find((r) => r.id === id) ?? null,
    hydrateCatalogRepo: <T extends { id: number }>(repo: T): T => {
      const found = repos.find((r) => r.id === repo.id)
      return (found ? { ...repo, ...found } : repo) as T
    },
  }
})
