/** biome-ignore-all lint/style/useNamingConvention: Test fixtures mirror GitHub API and marketplace fields. */
import type { Page, Route } from '@playwright/test'

export const repoPayload = {
  name: 'plugin-repo',
  full_name: 'example/plugin-repo',
  description: 'A mocked Claude Code plugin repository',
  html_url: 'https://github.com/example/plugin-repo',
  homepage: 'https://example.dev/plugin-repo',
  stargazers_count: 7,
  forks_count: 2,
  watchers_count: 3,
  open_issues_count: 1,
  topics: ['claude-code', 'plugins'],
  language: 'TypeScript',
  license: { name: 'MIT' },
  size: 2048,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
  pushed_at: '2026-06-02T00:00:00Z',
  default_branch: 'main',
  owner: {
    login: 'example',
    avatar_url: 'https://github.com/images/error/octocat_happy.gif',
    html_url: 'https://github.com/example',
    type: 'User',
  },
}

export const richMarketplacePayload = {
  plugins: [
    {
      name: 'Example Plugin',
      id: 'example-plugin',
      description: 'A plugin rendered from mocked marketplace data',
      version: '1.2.3',
      category: 'Testing',
      source: '.claude-plugin/plugin.json',
      author: {
        name: 'Example Maintainer',
        email: 'maintainer@example.dev',
      },
      keywords: ['testing', 'automation'],
      commands: ['commands/example.md', 'commands/review.md'],
      agents: ['agents/reviewer.md'],
      mcpServers: ['mcp/server.json'],
    },
    {
      name: 'Fallback Install Target',
      description: 'Uses the repository path when no plugin ID is present',
      source: {
        repo: 'elsewhere/shared-plugins',
        source: 'plugins/fallback.json',
      },
      author: {
        email: 'fallback@example.dev',
      },
      keywords: ['fallback'],
    },
    {
      description: 'This plugin intentionally omits a name',
      category: 'Metadata',
    },
  ],
}

export async function mockClipboard(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: () => Promise.resolve((globalThis as typeof globalThis & { __copiedText?: string }).__copiedText ?? ''),
        writeText: (text: string) => {
          ;(globalThis as typeof globalThis & { __copiedText?: string }).__copiedText = text
          return Promise.resolve()
        },
      },
    })
  })
}

export async function copiedText(page: Page) {
  return page.evaluate(() => (globalThis as typeof globalThis & { __copiedText?: string }).__copiedText ?? '')
}

export async function mockRepo(page: Page, repoPath = 'example/plugin-repo', payload = repoPayload) {
  await page.route(`https://api.github.com/repos/${repoPath}`, async (route: Route) => {
    await route.fulfill({ json: payload })
  })
}

export async function mockMarketplace(page: Page, repoPath = 'example/plugin-repo', branch = 'main', payload = richMarketplacePayload) {
  await page.route(`https://raw.githubusercontent.com/${repoPath}/${branch}/.claude-plugin/marketplace.json`, async (route: Route) => {
    await route.fulfill({ json: payload })
  })
}
