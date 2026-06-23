/** biome-ignore-all lint/style/useNamingConvention: GitHub API mocks use API field names. */
import { expect, test } from 'playwright/test'

const examplePluginHeading = /Example Plugin/

const repoPayload = {
  name: 'plugin-repo',
  full_name: 'example/plugin-repo',
  description: 'A mocked Claude Code plugin repository',
  html_url: 'https://github.com/example/plugin-repo',
  homepage: null,
  stargazers_count: 7,
  forks_count: 2,
  watchers_count: 3,
  open_issues_count: 1,
  topics: ['claude-code', 'plugins'],
  language: 'TypeScript',
  license: { name: 'MIT' },
  size: 42,
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

test('repo detail page renders mocked repository and plugin data', async ({ page }) => {
  await page.route('https://api.github.com/repos/example/plugin-repo', async (route) => {
    await route.fulfill({ json: repoPayload })
  })
  await page.route('https://raw.githubusercontent.com/example/plugin-repo/main/.claude-plugin/marketplace.json', async (route) => {
    await route.fulfill({
      json: {
        plugins: [
          {
            name: 'Example Plugin',
            id: 'example-plugin',
            description: 'A plugin rendered from mocked marketplace data',
            source: '.claude-plugin/plugin.json',
            commands: ['commands/example.md'],
          },
        ],
      },
    })
  })

  await page.goto('/example/plugin-repo')

  await expect(page.getByRole('heading', { name: 'plugin-repo' })).toBeVisible()
  await expect(page.getByRole('heading', { name: examplePluginHeading })).toBeVisible()
  await expect(page.getByText('/plugin install example-plugin@example-plugin')).toBeVisible()
})

test('repo detail page renders repository not found state', async ({ page }) => {
  await page.route('https://api.github.com/repos/missing/repo', async (route) => {
    await route.fulfill({ status: 404, json: { message: 'Not Found' } })
  })

  await page.goto('/missing/repo')

  await expect(page.getByText('Repository not found')).toBeVisible()
})

test('repo detail page renders no-plugin state for missing marketplace manifest', async ({ page }) => {
  await page.route('https://api.github.com/repos/example/plugin-repo', async (route) => {
    await route.fulfill({ json: repoPayload })
  })
  await page.route('https://raw.githubusercontent.com/example/plugin-repo/main/.claude-plugin/marketplace.json', async (route) => {
    await route.fulfill({ status: 404, body: 'Not Found' })
  })

  await page.goto('/example/plugin-repo')

  await expect(page.getByText('No Claude Code plugins found in this repository.')).toBeVisible()
})
