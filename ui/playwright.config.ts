/** biome-ignore-all lint/style/useNamingConvention: Playwright config uses baseURL as an API option. */
import { defineConfig, devices } from '@playwright/test'

const appPort = process.env.PORT ?? '3001'
const mockGithubPort = process.env.MOCK_GITHUB_PORT ?? '3100'
const mockGithubUrl = `http://127.0.0.1:${mockGithubPort}`
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${appPort}`

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 2,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: baseUrl,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  ...(process.env.PLAYWRIGHT_BASE_URL
    ? {}
    : {
        webServer: [
          {
            command: 'node tests/e2e/mock-github-server.mjs',
            reuseExistingServer: false,
            timeout: 30_000,
            url: `${mockGithubUrl}/health`,
          },
          {
            command: `cross-env-shell GITHUB_API_URL=${mockGithubUrl} GITHUB_RAW_URL=${mockGithubUrl} PORT=${appPort} "npm run build && npm run start"`,
            reuseExistingServer: false,
            timeout: 120_000,
            url: baseUrl,
          },
        ],
      }),
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
})
