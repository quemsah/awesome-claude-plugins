/** biome-ignore-all lint/style/useNamingConvention: Server environment uses uppercase keys. */
import { resolve } from 'node:path'
import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config.ts'

const catalogPath = resolve('tests/e2e/fixtures/standalone-repos.json')

// Build and serve a real catalog independently of the published production snapshot.
export default defineConfig({
  ...baseConfig,
  testMatch: 'standalone-plugin.spec.ts',
  testIgnore: [],
  webServer: Array.isArray(baseConfig.webServer)
    ? baseConfig.webServer.map((server) => ({
        ...server,
        // The default CI build belongs to the production catalog; build this fixture separately.
        command: server.command.replace('"bun run start"', '"bun run build && bun run start"'),
        env: { ...server.env, CATALOG_DATA_PATH: catalogPath, STANDALONE_E2E: '1' },
      }))
    : undefined,
})
