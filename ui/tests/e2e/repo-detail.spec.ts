import { expect, test } from '@playwright/test'
import { copiedText, mockClipboard } from './helpers.ts'

const noPluginsText = 'No Claude Code plugins found in this repository.'
const marketplaceErrorText = 'Failed to load marketplace manifest.'
const installButtonPattern = /install/i

test('repo detail page renders server-fetched repository and marketplace data', async ({ page }) => {
  await mockClipboard(page)
  await page.goto('/ykdojo/claude-code-tips')

  await expect(page.getByRole('heading', { name: 'claude-code-tips' })).toBeVisible()
  await expect(page.getByText('A mocked Claude Code plugin repository')).toBeVisible()
  const plugin = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Example Plugin@1.2.3' }) })
  await expect(plugin.getByText('/plugin install example-plugin@example-plugin')).toBeVisible()
  await plugin.getByRole('button', { name: 'Copy installation command' }).click()
  await expect.poll(() => copiedText(page)).toBe('/plugin install example-plugin@example-plugin')
})

test('repo detail page marks a repoPath-only plugin command as unverified', async ({ page }) => {
  await page.goto('/ykdojo/claude-code-tips')

  const plugin = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Fallback Install Target' }) })
  await expect(plugin.getByText('/plugin install fallback-install-target@ykdojo-claude-code-tips')).toBeVisible()
  await expect(plugin.getByText('unverified')).toBeVisible()
  await expect(plugin.getByRole('button', { name: 'Copy install command unavailable' })).toBeDisabled()
  await expect(plugin.getByRole('link', { name: 'Open source file plugins/fallback.json in a new tab' })).toHaveAttribute(
    'href',
    'https://github.com/elsewhere/shared-plugins/blob/main/plugins/fallback.json'
  )
})

test('repo detail page renders plugins without a name or identifier without an install command', async ({ page }) => {
  await page.goto('/ykdojo/claude-code-tips')

  const plugin = page.locator('article').filter({ hasText: 'A plugin without a name or identifier' })
  await expect(plugin.getByRole('button', { name: installButtonPattern })).toBeHidden()
})

test('repo detail page accepts marketplace manifests served as a plugin array', async ({ page }) => {
  await page.goto('/mksglu/context-mode')

  await expect(page.getByRole('heading', { name: 'Example Plugin@1.2.3' })).toBeVisible()
  await expect(page.getByText('/plugin install example-plugin@example-plugin')).toBeVisible()
})

test('repo detail page renders an empty plugin state when the manifest is missing', async ({ page }) => {
  await page.goto('/ZeframLou/call-me')

  await expect(page.getByRole('heading', { name: 'call-me' })).toBeVisible()
  await expect(page.getByText(noPluginsText)).toBeVisible()
})

test('repo detail page surfaces a recoverable error when the manifest fails to load', async ({ page }) => {
  await page.goto('/kaito-project/kaito')

  await expect(page.getByRole('heading', { name: 'kaito' })).toBeVisible()
  await expect(page.getByText(marketplaceErrorText)).toBeVisible()
  await expect(page.getByText(noPluginsText)).toBeHidden()
  await expect(page.getByRole('link', { name: 'View marketplace.json' })).toBeVisible()
})

test('repo detail page renders 404 when GitHub does not know the repository', async ({ page }) => {
  await page.goto('/jfernandez/mdserve')

  await expect(page.getByRole('heading', { name: '404' })).toBeVisible()
})

test('repo detail page renders the error boundary when GitHub fails', async ({ page }) => {
  await page.goto('/todorkolev/lean-playground')

  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible()
  await page.getByRole('link', { name: 'Back to directory' }).click()
  await expect(page).toHaveURL('/')
})

test('repo detail page rejects paths outside the catalog', async ({ page }) => {
  await page.goto('/missing/repo')

  await expect(page.getByRole('heading', { name: '404' })).toBeVisible()
})
