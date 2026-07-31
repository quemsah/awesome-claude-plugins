/** biome-ignore-all lint/style/useNamingConvention: Playwright config uses baseURL as an API option. */
import { defineConfig, devices } from '@playwright/test'

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001'

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
            url: 'http://127.0.0.1:3100/health',
          },
          {
            command:
              'GITHUB_API_URL=http://127.0.0.1:3100 GITHUB_RAW_URL=http://127.0.0.1:3100 npm run build && GITHUB_API_URL=http://127.0.0.1:3100 GITHUB_RAW_URL=http://127.0.0.1:3100 PORT=3001 npm run start',
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
