/** biome-ignore-all lint/style/useNamingConvention: Catalog and server environment keys use snake_case and uppercase names. */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config.ts'

const fixtureDirectory = mkdtempSync(join(tmpdir(), 'awesome-claude-plugins-vitals-'))
const catalogPath = join(fixtureDirectory, 'repos.json')
const sqlitePath = resolve('src/data/catalog.vitals.sqlite')
const manifestPath = resolve('src/data/catalog.vitals.manifest.json')

// A stable catalog with enough rows to make /browse/2 a real page and a known detail route.
writeFileSync(
  catalogPath,
  JSON.stringify(
    Array.from({ length: 64 }, (_, index) => ({
      id: index + 1,
      owner: index === 0 ? 'ykdojo' : 'vitals',
      repo_name: index === 0 ? 'claude-code-tips' : `page-vitals-${index + 1}`,
      description: `Deterministic page vitals benchmark repository ${index + 1}.`,
      stargazers_count: 10_000 - index,
      forks_count: 100 - index,
      subscribers_count: 0,
      plugins_count: 1,
      plugins: [{ name: 'Benchmark Plugin', description: 'Fixture plugin for page rendering.' }],
      catalog_updated_at: '2026-11-01T00:00:00.000Z',
    }))
  )
)

export default defineConfig({
  ...baseConfig,
  testDir: './tests/performance',
  testMatch: '**/*.spec.ts',
  testIgnore: [],
  webServer: Array.isArray(baseConfig.webServer)
    ? baseConfig.webServer.map((server, index) => ({
        ...server,
        // Cold production builds exceed the general e2e server timeout in slower local environments.
        timeout: 300_000,
        ...(index === 1
          ? {
              env: {
                ...server.env,
                CATALOG_DATA_PATH: catalogPath,
                CATALOG_SQLITE_PATH: sqlitePath,
                CATALOG_MANIFEST_PATH: manifestPath,
                STANDALONE_E2E: '1',
              },
            }
          : {}),
      }))
    : baseConfig.webServer,
})
