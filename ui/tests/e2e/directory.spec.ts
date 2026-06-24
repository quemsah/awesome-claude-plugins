import { expect, type Page, test } from '@playwright/test'
import { copiedText, mockClipboard } from './helpers.ts'

const pluginsAvailableText = /plugins available across/i
const detailsLinkName = /View details for /
const toggleThemeName = /Toggle theme/
const darkThemeName = /dark/
const statsUrl = /\/stats$/
const aboutUrl = /\/about$/
const darkThemeButtonName = /Current theme: Dark/
const allTimeChartText = /^All time - Daily repository count/
const last30DaysChartText = /^Last 30 days - Daily repository count/
const last7DaysChartText = /^Last 7 days - Daily repository count/

async function chooseSortOption(page: Page, optionName: 'Stars' | 'Forks' | 'Plugins') {
  await page.getByRole('combobox', { name: 'Sort by' }).click()
  await page.getByRole('option', { name: optionName }).click()
}

async function expectFirstDetailsLink(page: Page, repoPath: string) {
  await expect(page.getByRole('link', { name: detailsLinkName }).first()).toHaveAttribute('aria-label', `View details for ${repoPath}`)
}

test('header navigation, external actions, and theme selection work across routes', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Awesome Claude Plugins' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Claude Code documentation' })).toHaveAttribute(
    'href',
    'https://code.claude.com/docs/en/plugins'
  )
  await expect(page.getByRole('link', { name: 'GitHub repository' })).toHaveAttribute(
    'href',
    'https://github.com/quemsah/awesome-claude-plugins'
  )

  await page.getByRole('button', { name: toggleThemeName }).click()
  await page.getByRole('menuitem', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveClass(darkThemeName)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('theme-preference'))).toBe('dark')

  await page.getByRole('link', { name: 'View statistics' }).click()
  await expect(page).toHaveURL(statsUrl)
  await expect(page.getByRole('heading', { name: 'Repositories Statistics' })).toBeVisible()
  await expect(page.getByRole('button', { name: darkThemeButtonName })).toBeVisible()

  await page.getByRole('link', { name: 'About project' }).click()
  await expect(page).toHaveURL(aboutUrl)
  await expect(page.getByRole('heading', { name: 'About This Project' })).toBeVisible()

  await page.getByRole('link', { name: 'Search repositories' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: 'Awesome Claude Plugins' })).toBeVisible()
})

test('home page search updates result counts, visible cards, and empty state', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByText(pluginsAvailableText)).toBeVisible()

  await page.getByRole('searchbox', { name: 'Search repositories' }).fill('superpowers')
  await expect(page.getByRole('link', { name: 'View details for obra/superpowers' })).toBeVisible()
  await expect(page.getByText(pluginsAvailableText)).toBeVisible()

  await page.getByRole('searchbox', { name: 'Search repositories' }).fill('definitely-no-matching-repository-name')
  await expect(page.getByText('No repositories match your search')).toBeVisible()
  await expect(page.getByText('0 plugins available across 0 repositories')).toBeVisible()

  await page.getByRole('searchbox', { name: 'Search repositories' }).fill('')
  await expect(page.getByText('No repositories match your search')).toBeHidden()
  await expectFirstDetailsLink(page, 'obra/superpowers')
})

test('home page sort modes reorder the first visible repository card', async ({ page }) => {
  await page.goto('/')

  await expectFirstDetailsLink(page, 'obra/superpowers')

  await chooseSortOption(page, 'Forks')
  await expectFirstDetailsLink(page, 'affaan-m/ECC')

  await chooseSortOption(page, 'Plugins')
  await expectFirstDetailsLink(page, 'tomevault-io/claude-code-plugins')

  await chooseSortOption(page, 'Stars')
  await expectFirstDetailsLink(page, 'obra/superpowers')
})

test('repository cards expose details, GitHub links, and copyable marketplace commands', async ({ page }) => {
  await mockClipboard(page)
  await page.goto('/')

  const superpowersCard = page.locator('li').filter({ has: page.getByRole('link', { name: 'View details for obra/superpowers' }) })

  await expect(superpowersCard.getByRole('link', { name: 'View details for obra/superpowers' })).toHaveAttribute(
    'href',
    '/obra/superpowers'
  )
  await expect(superpowersCard.getByRole('link', { name: 'View obra/superpowers on GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/obra/superpowers'
  )
  await expect(superpowersCard.getByText('/plugin marketplace add obra/superpowers')).toBeVisible()

  await superpowersCard.getByRole('button', { name: 'Copy marketplace command' }).click()
  await expect(superpowersCard.getByRole('button', { name: 'Marketplace command copied' })).toBeVisible()
  await expect.poll(() => copiedText(page)).toBe('/plugin marketplace add obra/superpowers')
})

test('repository grid loads more cards as the user reaches the end of the current batch', async ({ page }) => {
  await page.goto('/')

  const detailsLinks = page.getByRole('link', { name: detailsLinkName })
  await expect(detailsLinks).toHaveCount(24)

  await page.getByText('Loading more repositories...').scrollIntoViewIfNeeded()
  await expect.poll(() => detailsLinks.count()).toBeGreaterThan(24)
})

test('stats page filters chart ranges and trend state', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-06-24T12:00:00Z'))
  await page.goto('/stats')

  await expect(page.getByRole('heading', { name: 'Repositories Statistics' })).toBeVisible()
  await expect(page.getByText(allTimeChartText)).toBeVisible()
  await expect(page.getByText('Total Repositories')).toBeVisible()
  await expect(page.getByText('Avg Daily Increase')).toBeVisible()
  await expect(page.getByRole('application', { name: 'Repository growth over time' })).toBeVisible()

  await page.getByRole('combobox').click()
  await page.getByRole('option', { name: 'Last 30 days' }).click()
  await expect(page.getByText(last30DaysChartText)).toBeVisible()
  await expect(page.getByText('Trend:')).toBeVisible()

  await page.getByRole('combobox').click()
  await page.getByRole('option', { name: 'Last 7 days' }).click()
  await expect(page.getByText(last7DaysChartText)).toBeVisible()
  await expect(page.getByText('Trend:')).toBeVisible()

  await page.getByRole('combobox').click()
  await page.getByRole('option', { name: 'All time' }).click()
  await expect(page.getByText(allTimeChartText)).toBeVisible()
  await expect(page.getByText('Trend:')).toBeHidden()
})

test('about page exposes static project cards and header navigation', async ({ page }) => {
  await page.goto('/about')

  await expect(page.getByRole('heading', { name: 'About This Project' })).toBeVisible()
  await expect(page.getByText('Automated Discovery')).toBeVisible()
  await expect(page.getByText('Why?')).toBeVisible()

  await page.getByRole('link', { name: 'Search repositories' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: 'Awesome Claude Plugins' })).toBeVisible()
})
