/** biome-ignore-all lint/style/useNamingConvention: GitHub API mocks use API field names. */
import { expect, test } from '@playwright/test'
import { copiedText, mockClipboard, mockMarketplace, mockRepo, repoPayload, richMarketplacePayload } from './helpers.ts'

const pluginRepoPath = 'example/plugin-repo'
const marketplaceUrl = 'https://raw.githubusercontent.com/example/plugin-repo/main/.claude-plugin/marketplace.json'
const repositoryUrl = 'https://api.github.com/repos/example/plugin-repo'
const loadingRepositoryName = 'Loading repository...'
const examplePluginHeading = 'Example Plugin@1.2.3'
const fallbackPluginHeading = 'Fallback Install Target'
const unnamedPluginHeading = 'Unnamed Plugin'
const failedRepositoryText = 'Failed to load repository'
const repositoryNotFoundText = 'Repository not found'
const noPluginsText = 'No Claude Code plugins found in this repository.'

test('repo detail page shows the repository loading state before data resolves', async ({ page }) => {
  let releaseRepo: () => void = () => undefined
  let resolveRepoRequestStarted: () => void = () => undefined
  const repoRequestStarted = new Promise<void>((resolveStarted) => {
    resolveRepoRequestStarted = resolveStarted
  })
  await page.route(repositoryUrl, async (route) => {
    resolveRepoRequestStarted()
    await new Promise<void>((resolveRelease) => {
      releaseRepo = resolveRelease
    })
    await route.fulfill({ json: repoPayload })
  })
  await mockMarketplace(page)

  await page.goto(`/${pluginRepoPath}`)
  await repoRequestStarted

  await expect(page.locator('main[aria-busy="true"]')).toBeVisible()
  await expect(page.getByRole('status', { name: loadingRepositoryName })).toBeAttached()
  await expect(page.getByRole('link', { name: 'Back to all repositories' })).toHaveAttribute('href', '/')
  await expect(page.locator('h2').filter({ hasText: 'Available Plugins' })).toBeVisible()

  releaseRepo()
  await expect(page.getByRole('heading', { name: 'plugin-repo' })).toBeVisible()
})

test('repo detail page renders repository metadata, links, and rich plugin cards', async ({ page }) => {
  await mockClipboard(page)
  await mockRepo(page)
  await mockMarketplace(page)

  await page.goto(`/${pluginRepoPath}`)

  await expect(page.getByRole('heading', { name: 'plugin-repo' })).toBeVisible()
  await expect(page.getByText('A mocked Claude Code plugin repository')).toBeVisible()
  await expect(page.getByRole('link', { name: "View example's GitHub profile" })).toHaveAttribute('href', 'https://github.com/example')
  await expect(page.getByRole('link', { name: 'Visit repository homepage' })).toHaveAttribute('href', 'https://example.dev/plugin-repo')
  await expect(page.getByRole('link', { name: 'View example/plugin-repo on GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/example/plugin-repo'
  )
  await expect(page.getByText('7').first()).toBeVisible()
  await expect(page.getByText('stars')).toBeVisible()
  await expect(page.getByText('forks')).toBeVisible()
  await expect(page.getByText('watchers')).toBeVisible()
  await expect(page.getByText('issues')).toBeVisible()
  await expect(page.getByText('claude-code')).toBeVisible()
  await expect(page.locator('[data-slot="badge"]').filter({ hasText: 'plugins' })).toBeVisible()
  await expect(page.getByText('TypeScript')).toBeVisible()
  await expect(page.getByText('MIT', { exact: true })).toBeVisible()
  await expect(page.getByText('2.0 MB')).toBeVisible()
  await expect(page.getByText('01.01.2026')).toBeVisible()
  await expect(page.getByText('01.06.2026')).toBeVisible()
  await expect(page.getByText('02.06.2026')).toBeVisible()

  const examplePlugin = page.locator('article').filter({ has: page.getByRole('heading', { name: examplePluginHeading }) })
  await expect(examplePlugin.locator('[data-slot="badge"]')).toContainText(['Testing', 'testing', 'automation'])
  await expect(examplePlugin.getByText('/plugin install example-plugin@example-plugin')).toBeVisible()
  await expect(examplePlugin.getByText('A plugin rendered from mocked marketplace data')).toBeVisible()
  await expect(examplePlugin.getByRole('link', { name: 'Open source file .claude-plugin/plugin.json in a new tab' })).toHaveAttribute(
    'href',
    'https://github.com/example/plugin-repo/blob/main/.claude-plugin/plugin.json'
  )
  await expect(examplePlugin.getByText('Example Maintainer')).toBeVisible()
  await expect(examplePlugin.getByText('maintainer@example.dev')).toBeVisible()
  await expect(examplePlugin.getByText('example-plugin', { exact: true })).toBeVisible()
  await expect(examplePlugin.getByText('Commands (2)')).toBeVisible()
  await expect(examplePlugin.getByRole('link', { name: 'Open commands/example.md in a new tab' })).toHaveAttribute(
    'href',
    'https://github.com/example/plugin-repo/blob/main/commands/example.md'
  )
  await expect(examplePlugin.getByText('Agents (1)')).toBeVisible()
  await expect(examplePlugin.getByRole('link', { name: 'Open agents/reviewer.md in a new tab' })).toHaveAttribute(
    'href',
    'https://github.com/example/plugin-repo/blob/main/agents/reviewer.md'
  )
  await expect(examplePlugin.getByText('MCP Servers (1)')).toBeVisible()
  await expect(examplePlugin.getByRole('link', { name: 'Open mcp/server.json in a new tab' })).toHaveAttribute(
    'href',
    'https://github.com/example/plugin-repo/blob/main/mcp/server.json'
  )

  await examplePlugin.getByRole('button', { name: 'Copy installation command' }).click()
  await expect(examplePlugin.getByRole('button', { name: 'Installation command copied' })).toBeVisible()
  await expect.poll(() => copiedText(page)).toBe('/plugin install example-plugin@example-plugin')

  const fallbackPlugin = page.locator('article').filter({ has: page.getByRole('heading', { name: fallbackPluginHeading }) })
  await expect(fallbackPlugin.getByText('/plugin install fallback-install-target@example-plugin-repo')).toBeVisible()
  await expect(fallbackPlugin.getByRole('link', { name: 'Open source file plugins/fallback.json in a new tab' })).toHaveAttribute(
    'href',
    'https://github.com/elsewhere/shared-plugins/blob/main/plugins/fallback.json'
  )
  await expect(fallbackPlugin.getByText('fallback@example.dev')).toBeVisible()

  const unnamedPlugin = page.locator('article').filter({ has: page.getByRole('heading', { name: unnamedPluginHeading }) })
  await expect(unnamedPlugin.getByText('Metadata')).toBeVisible()
  await expect(unnamedPlugin.getByRole('button', { name: 'Copy installation command' })).toBeHidden()
})

test('repo detail page accepts marketplace manifests served as a plugin array', async ({ page }) => {
  await mockRepo(page)
  await page.route(marketplaceUrl, async (route) => {
    await route.fulfill({ json: richMarketplacePayload.plugins.slice(0, 1) })
  })

  await page.goto(`/${pluginRepoPath}`)

  await expect(page.getByRole('heading', { name: examplePluginHeading })).toBeVisible()
  await expect(page.getByText('/plugin install example-plugin@example-plugin')).toBeVisible()
})

test('repo detail page renders empty plugin state for missing or invalid marketplace data', async ({ page }) => {
  await mockRepo(page)
  await page.route(marketplaceUrl, async (route) => {
    await route.fulfill({ status: 404, body: 'Not Found' })
  })

  await page.goto(`/${pluginRepoPath}`)

  await expect(page.getByText(noPluginsText)).toBeVisible()
})

test('repo detail page hides plugin content when marketplace loading fails', async ({ page }) => {
  await mockRepo(page)
  await page.route(marketplaceUrl, async (route) => {
    await route.fulfill({ status: 500, json: { message: 'Server Error' } })
  })

  await page.goto(`/${pluginRepoPath}`)

  await expect(page.getByRole('heading', { name: 'plugin-repo' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Available Plugins' })).toBeHidden()
  await expect(page.getByText(noPluginsText)).toBeHidden()
})

test('repo detail page renders repository not-found and failure recovery states', async ({ page }) => {
  await page.route('https://api.github.com/repos/missing/repo', async (route) => {
    await route.fulfill({ status: 404, json: { message: 'Not Found' } })
  })
  await page.goto('/missing/repo')

  await expect(page.getByText(repositoryNotFoundText)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Back to all repositories' })).toHaveAttribute('href', '/')

  await page.route('https://api.github.com/repos/broken/repo', async (route) => {
    await route.fulfill({ status: 500, json: { message: 'Server Error' } })
  })
  await page.goto('/broken/repo')

  await expect(page.getByText(failedRepositoryText)).toBeVisible()
  await page.getByRole('link', { name: 'Back to all repositories' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: 'Awesome Claude Plugins' })).toBeVisible()
})
