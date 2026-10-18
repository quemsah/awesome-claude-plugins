import { expect, test } from '@playwright/test'
import { copiedText, mockClipboard } from './helpers.ts'

const noPluginsText = 'No Claude Code plugins found in this repository.'
const marketplaceErrorText = 'Failed to load marketplace manifest.'
const marketplaceMissingText = 'No marketplace manifest was found in this repository.'
const staleRepositoryText = 'Live GitHub data is temporarily unavailable.'
const unavailableRepositoryText = 'no longer available on GitHub'
const mdserveCanonicalPattern = /\/jfernandez\/mdserve$/
const repoCanonicalPattern = /\/ykdojo\/claude-code-tips$/
const repoMarkdownAlternatePattern = /\/ykdojo\/claude-code-tips\.md$/
const repoOpenGraphImagePattern = /\/og\/ykdojo\/claude-code-tips$/

test('repo detail page serves catalog repository data in its HTML without contacting GitHub', async ({ page }) => {
  const html = await (await page.request.get('/ykdojo/claude-code-tips')).text()

  expect(html).toContain('45+ tips for getting the most out of Claude Code')
  expect(html).not.toContain('A mocked Claude Code plugin repository')
  expect(html).not.toContain('>Unknown<')
  expect(html).not.toContain(staleRepositoryText)
  expect(html).not.toContain(unavailableRepositoryText)
})

test('repo detail page refreshes repository and marketplace data in the browser', async ({ page }) => {
  await mockClipboard(page)
  await page.goto('/ykdojo/claude-code-tips')

  await expect(page.getByRole('heading', { name: 'claude-code-tips' })).toBeVisible()
  await expect(page.getByText('A mocked Claude Code plugin repository')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Visit repository homepage' })).toBeVisible()
  await expect(page.locator('[data-slot="badge"]').filter({ hasText: 'issues' })).toHaveCount(1)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', repoCanonicalPattern)
  await expect(page.locator('link[rel="alternate"][type="text/markdown"]')).toHaveAttribute('href', repoMarkdownAlternatePattern)
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', repoOpenGraphImagePattern)
  const jsonLd = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((scripts) => scripts.map((script) => JSON.parse(script.textContent ?? '')))
  expect(jsonLd).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        '@type': 'SoftwareSourceCode',
        url: expect.stringMatching(repoCanonicalPattern),
      }),
    ])
  )
  expect(JSON.stringify(jsonLd)).not.toContain('"Unknown"')
  const plugin = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Example Plugin@1.2.3' }) })
  await expect(plugin.getByText('/plugin install example-plugin@ykdojo')).toBeVisible()
  await expect(plugin.getByRole('link', { name: 'Open ./commands/example.md in a new tab' })).toHaveAttribute(
    'href',
    'https://github.com/ykdojo/claude-code-tips/blob/main/./commands/example.md'
  )
  await expect(plugin.getByRole('link', { name: 'Open ./agents/reviewer.md in a new tab' })).toBeVisible()
  await plugin.getByRole('button', { name: 'Copy installation command' }).click()
  await expect.poll(() => copiedText(page)).toBe('/plugin install example-plugin@ykdojo')
})

test('repo detail page uses the official plugin and marketplace names for install commands', async ({ page }) => {
  await mockClipboard(page)
  await page.goto('/ykdojo/claude-code-tips')

  const plugin = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Fallback Install Target' }) })
  await expect(plugin.getByText('/plugin install fallback-install-target@ykdojo')).toBeVisible()
  await plugin.getByRole('button', { name: 'Copy installation command' }).click()
  await expect.poll(() => copiedText(page)).toBe('/plugin install fallback-install-target@ykdojo')
  await expect(plugin.getByRole('link', { name: 'Open source repository elsewhere/shared-plugins in a new tab' })).toHaveAttribute(
    'href',
    'https://github.com/elsewhere/shared-plugins/tree/0123456789abcdef0123456789abcdef01234567'
  )
})

test('repo detail page skips invalid marketplace entries and keeps valid plugins', async ({ page }) => {
  await page.goto('/ykdojo/claude-code-tips')

  await expect(page.getByRole('heading', { name: 'Example Plugin@1.2.3' })).toBeVisible()
  await expect(page.getByText('A plugin without a name or identifier')).toHaveCount(0)
})

test('repo detail page installs a marketplace entry under the marketplace name', async ({ page }) => {
  await page.goto('/mksglu/context-mode')

  await expect(page.getByRole('heading', { name: 'Example Plugin@1.2.3' })).toBeVisible()
  await expect(page.getByText('/plugin install example-plugin@context-mode')).toBeVisible()
})

test('repo detail page renders an empty plugin state when the manifest is missing', async ({ page }) => {
  await page.goto('/ZeframLou/call-me')

  await expect(page.getByRole('heading', { name: 'call-me' })).toBeVisible()
  await expect(page.getByText(marketplaceMissingText)).toBeVisible()
  await expect(page.getByText(noPluginsText)).toBeHidden()
})

test('repo detail page surfaces a recoverable error when the manifest fails to load', async ({ page }) => {
  await page.goto('/kaito-project/kaito')

  await expect(page.getByRole('heading', { name: 'kaito' })).toBeVisible()
  await expect(page.getByText(marketplaceErrorText)).toBeVisible()
  await expect(page.getByText(noPluginsText)).toBeHidden()
  await expect(page.getByRole('link', { name: 'View marketplace.json' })).toBeVisible()
})

test('repo detail page renders a catalog snapshot when GitHub reports the repository missing', async ({ page }) => {
  await page.goto('/jfernandez/mdserve')

  await expect(page.getByRole('heading', { name: 'mdserve' })).toBeVisible()
  await expect(page.getByText('[Archived] Markdown preview server for AI coding agents.')).toBeVisible()
  await expect(page.getByText(unavailableRepositoryText)).toBeVisible()
  await expect(page.getByText(staleRepositoryText)).toBeHidden()
  await expect(page.locator('[data-slot="badge"]').filter({ hasText: 'issues' })).toHaveCount(0)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', mdserveCanonicalPattern)
  await expect(page.getByText(marketplaceMissingText)).toBeVisible()
})

test('repo detail page renders a catalog snapshot when GitHub fails', async ({ page }) => {
  await page.goto('/todorkolev/lean-playground')

  await expect(page.getByRole('heading', { name: 'lean-playground' })).toBeVisible()
  await expect(page.getByText(staleRepositoryText)).toBeVisible()
  await page.getByRole('link', { name: 'Back to all repositories' }).click()
  await expect(page).toHaveURL('/')
})

test('repo detail page rejects paths outside the catalog', async ({ page }) => {
  await page.goto('/missing/repo')

  await expect(page.getByRole('heading', { name: '404' })).toBeVisible()
})
