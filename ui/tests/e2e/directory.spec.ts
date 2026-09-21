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
const qSuperpowersRegex = /\?q=superpowers$/
const sortForksRegex = /\?sort=forks-desc$/
const sortPluginsRegex = /\?sort=plugins-desc$/
const qSuperpowersSortForksRegex = /\?q=superpowers&sort=forks-desc$/
const qHelloRegex = /\?q=hello$/
const qNoMatchesRegex = /\?q=definitely-no-matching-repository-name$/
const noindexFollowRobotsPattern = /noindex,\s*follow/
const indexFollowRobotsPattern = /(?:^|,\s*)index,\s*follow(?:\s*,|$)/
const rootCanonicalPattern = /awesomeclaudeplugins\.com\/?$/
const sortOptionForksRegex = /Forks/
const sortOptionStarsRegex = /Stars/
const detailsLabelRegex = /^View details for /

async function chooseSortOption(page: Page, optionName: 'Stars' | 'Forks' | 'Plugins') {
  await page.getByRole('combobox', { name: 'Sort by' }).click()
  await page.getByRole('option', { name: optionName }).click()
}

async function expectFirstDetailsLink(page: Page, repoPath: string) {
  await expect(page.getByRole('link', { name: detailsLinkName }).first()).toHaveAttribute('aria-label', `View details for ${repoPath}`)
}

/**
 * Holds every catalog request until the returned release runs, so a test can read what the grid says
 * while a request is still in flight instead of racing the response, whose duration the test controls.
 */
async function holdCatalogRequests(page: Page): Promise<() => void> {
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/catalog*', async (route) => {
    await held
    const response = await route.fetch()
    await route.fulfill({ response })
  })
  return release
}

/** Requests the page itself made to the catalog endpoint, read off the browser's resource timings. */
function catalogRequestCount(page: Page) {
  return page.evaluate(() => performance.getEntriesByType('resource').filter((r) => r.name.includes('/api/catalog')).length)
}

function statCardValue(page: Page, title: string) {
  return page.locator('[data-slot=card]', { has: page.getByRole('heading', { name: title }) }).locator('[data-slot=card-content] > div')
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

  await page.locator('a[aria-label="Search repositories"]').click()
  await page.waitForURL('/#search')
  await expect(page.getByRole('heading', { name: 'Awesome Claude Plugins' })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: 'Search repositories' })).toBeFocused()
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
  await expect(page).toHaveURL(qNoMatchesRegex)

  await page.getByRole('searchbox', { name: 'Search repositories' }).fill('')
  await expect(page).toHaveURL('/')
  await expect(page.getByText('No repositories match your search')).toBeHidden()
  await expectFirstDetailsLink(page, 'obra/superpowers')
})

test('a search that replaces the results reports searching rather than loading more', async ({ page }) => {
  const release = await holdCatalogRequests(page)
  await page.goto('/')

  await expect(page.getByRole('link', { name: detailsLinkName }).first()).toBeVisible()
  const loadStatus = page.locator('#repo-results > p[role="status"]')

  await page.getByRole('searchbox', { name: 'Search repositories' }).fill('superpowers')
  await expect(page.getByText('Searching repositories...')).toBeVisible()
  await expect(loadStatus).toHaveText('Searching repositories.')
  await expect(page.getByText('Loading more repositories')).toHaveCount(0)

  release()
  await expect(page.getByRole('link', { name: 'View details for obra/superpowers' }).first()).toBeVisible()
  await expect(loadStatus).toHaveText('')
})

test('reaching the end of the grid reports loading more rather than searching', async ({ page }) => {
  const release = await holdCatalogRequests(page)
  await page.goto('/')

  await expect(page.getByRole('link', { name: detailsLinkName }).first()).toBeVisible()
  const loadStatus = page.locator('#repo-results > p[role="status"]')

  await page.getByText('More repositories available').scrollIntoViewIfNeeded()
  await expect(loadStatus).toHaveText('Loading more repositories.')
  await expect(page.getByText('Searching repositories')).toHaveCount(0)

  release()
  await expect(page.getByRole('link', { name: detailsLinkName })).toHaveCount(48)
  await expect(loadStatus).toHaveText('Loaded 24 more repositories.')
})

test('a search started from an empty result set reports searching instead of no matches', async ({ page }) => {
  const release = await holdCatalogRequests(page)
  await page.goto('/?q=definitely-no-matching-repository-name')

  const noMatches = page.getByText('No repositories match your search')
  await expect(noMatches).toBeVisible()
  await expect(page.locator('#repo-results')).toHaveCount(0)

  await page.getByRole('searchbox', { name: 'Search repositories' }).fill('superpowers')
  await expect(page.getByText('Searching repositories...')).toBeVisible()
  await expect(noMatches).toBeHidden()

  release()
  await expect(page.getByRole('link', { name: 'View details for obra/superpowers' }).first()).toBeVisible()
})

test('home page keeps query variants out of search indexes', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', indexFollowRobotsPattern)

  await page.goto('/?q=superpowers')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', noindexFollowRobotsPattern)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', rootCanonicalPattern)

  await page.goto('/?sort=forks-desc')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', noindexFollowRobotsPattern)
})

test('home page sort modes update the visible repository ordering', async ({ page }) => {
  await page.goto('/')

  const firstDetailsLink = page.getByRole('link', { name: detailsLinkName }).first()
  const defaultFirstRepository = await firstDetailsLink.getAttribute('aria-label')
  if (!defaultFirstRepository) {
    throw new Error('Expected the first repository card to expose an accessible details label')
  }

  await chooseSortOption(page, 'Forks')
  await expect(firstDetailsLink).not.toHaveAttribute('aria-label', defaultFirstRepository)

  await chooseSortOption(page, 'Plugins')
  await expect(firstDetailsLink).toHaveAttribute('aria-label', detailsLabelRegex)

  await chooseSortOption(page, 'Stars')
  await expect(firstDetailsLink).toHaveAttribute('aria-label', defaultFirstRepository)
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

  await page.getByText('More repositories available').scrollIntoViewIfNeeded()
  await expect.poll(() => detailsLinks.count()).toBeGreaterThan(24)
})

test('a footer arrival during the settle window is deferred instead of dropped', async ({ page }) => {
  await page.goto('/')

  const detailsLinks = page.getByRole('link', { name: detailsLinkName })
  await expect(detailsLinks).toHaveCount(24)

  await page.getByText('More repositories available').scrollIntoViewIfNeeded()
  await expect(detailsLinks).toHaveCount(48)

  // The previous page has only just landed, so this second arrival is inside SETTLE_MS. It must be
  // remembered and replayed after the landing layout settles rather than requiring another scroll.
  await page.getByText('More repositories available').scrollIntoViewIfNeeded()
  await expect(detailsLinks).toHaveCount(72)
})

test('a layout move that scrolls nothing loads no further page', async ({ page }) => {
  await page.goto('/')

  const detailsLinks = page.getByRole('link', { name: detailsLinkName })
  await expect(detailsLinks).toHaveCount(24)
  await page.getByText('More repositories available').scrollIntoViewIfNeeded()
  await expect.poll(() => detailsLinks.count()).toBeGreaterThan(24)

  const cards = await detailsLinks.count()
  const requests = await catalogRequestCount(page)
  const scrolledTo = await page.evaluate(() => window.scrollY)

  // A landing whose rows come out shorter than the placeholder rows lifts the trigger back into view
  // later than any settle window, with the scroll position never having moved. That is the document
  // moving rather than the visitor arriving, and it must not start another page.
  const broughtIntoView = await page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>('#repo-results > ul')
    const trigger = document.querySelector('#repo-results > div')
    if (!(grid && trigger)) return false
    grid.style.marginBottom = `${-(trigger.getBoundingClientRect().top - window.innerHeight / 2)}px`
    const rect = trigger.getBoundingClientRect()
    return rect.top < window.innerHeight && rect.bottom > 0
  })
  expect(broughtIntoView).toBe(true)
  await page.waitForTimeout(3_000)

  expect(await page.evaluate(() => window.scrollY)).toBe(scrolledTo)
  expect(await catalogRequestCount(page)).toBe(requests)
  await expect(detailsLinks).toHaveCount(cards)
})

test('automatic paging rearms after a replacement shortens the document', async ({ page }) => {
  await page.goto('/')

  const detailsLinks = page.getByRole('link', { name: detailsLinkName })
  await expect(detailsLinks).toHaveCount(24)

  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('#repo-results > div > button')?.click()
  })
  await expect(detailsLinks).toHaveCount(48)
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('#repo-results > div > button')?.click()
  })
  await expect(detailsLinks).toHaveCount(72)

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  const beforeReplaceScrollY = await page.evaluate(() => window.scrollY)
  expect(beforeReplaceScrollY).toBeGreaterThan(0)

  const scrollBeforeInput = await page.evaluate(() => window.scrollY)
  await page.getByRole('searchbox', { name: 'Search repositories' }).evaluate((input) => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(input, 'hello')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforeInput)

  await expect(detailsLinks).toHaveCount(24)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(beforeReplaceScrollY)

  // The replacement has shortened the document below the old request-start offset. Moving away from
  // the footer and back again must re-arm automatic paging without requiring an impossible scrollY.
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(500)
  await page.getByText('More repositories available').scrollIntoViewIfNeeded()
  await expect.poll(() => detailsLinks.count()).toBeGreaterThan(24)
})

test('replacing a complete short list says it is searching without a pagination footer', async ({ page }) => {
  await page.goto('/?q=nemotron')

  await expect(page.getByRole('link', { name: detailsLinkName })).toHaveCount(3)
  await expect(page.locator('#repo-results > div')).toHaveCount(0)

  const release = await holdCatalogRequests(page)
  await page.getByRole('searchbox', { name: 'Search repositories' }).fill('hello')
  await expect(page.getByText('Searching repositories...')).toBeVisible()

  release()
  await expect(page.getByRole('link', { name: detailsLinkName })).toHaveCount(24)
})

test('a replacement that lands a longer first page does not announce more repositories', async ({ page }) => {
  await page.goto('/?q=nemotron')

  const detailsLinks = page.getByRole('link', { name: detailsLinkName })
  await expect(detailsLinks).toHaveCount(3)
  const loadStatus = page.locator('#repo-results > p[role="status"]')

  // Three matches become 24, so the list grows and the first card can well be the same repository: the
  // only thing that says whether this was an append is the operation that issued the request.
  await page.getByRole('searchbox', { name: 'Search repositories' }).fill('')
  await expect(detailsLinks).toHaveCount(24)
  await expect(loadStatus).toHaveText('')
})

test('stats page filters chart ranges and trend state', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-21T12:00:00Z'))
  await page.goto('/stats')

  const averageDailyIncrease = statCardValue(page, 'Avg Daily Increase')
  const allTimeAverage = (await averageDailyIncrease.textContent()) ?? ''

  await expect(page.getByRole('heading', { name: 'Repositories Statistics' })).toBeVisible()
  await expect(page.getByText(allTimeChartText)).toBeVisible()
  await expect(page.getByText('Total Repositories')).toBeVisible()
  await expect(page.getByText('Avg Daily Increase')).toBeVisible()
  await expect(page.getByRole('application', { name: 'Repository growth over time' })).toBeVisible()

  await page.getByRole('combobox').click()
  await page.getByRole('option', { name: 'Last 30 days' }).click()
  await expect(page.getByText(last30DaysChartText)).toBeVisible()
  await expect(page.getByText('Trend:')).toBeVisible()
  await expect(averageDailyIncrease).not.toHaveText(allTimeAverage)
  const last30DaysAverage = (await averageDailyIncrease.textContent()) ?? ''

  await page.getByRole('combobox').click()
  await page.getByRole('option', { name: 'Last 7 days' }).click()
  await expect(page.getByText(last7DaysChartText)).toBeVisible()
  await expect(page.getByText('Trend:')).toBeVisible()
  await expect(averageDailyIncrease).not.toHaveText(last30DaysAverage)

  await page.getByRole('combobox').click()
  await page.getByRole('option', { name: 'All time' }).click()
  await expect(page.getByText(allTimeChartText)).toBeVisible()
  await expect(page.getByText('Trend:')).toBeHidden()
  await expect(averageDailyIncrease).toHaveText(allTimeAverage)
})

test('about page exposes static project cards and header navigation', async ({ page }) => {
  await page.goto('/about')

  await expect(page.getByRole('heading', { name: 'About This Project' })).toBeVisible()
  await expect(page.getByText('Automated Discovery')).toBeVisible()
  await expect(page.getByText('Why?')).toBeVisible()

  await page.locator('a[aria-label="Search repositories"]').click()
  await page.waitForURL('/#search')
  await expect(page.getByRole('heading', { name: 'Awesome Claude Plugins' })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: 'Search repositories' })).toBeFocused()
})

test('home page persists search term in url query parameters', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('searchbox', { name: 'Search repositories' })).toHaveValue('')
  await expect(page).toHaveURL('/')

  await page.getByRole('searchbox', { name: 'Search repositories' }).fill('hello')
  await expect(page).toHaveURL(qHelloRegex)
  await expect(page.getByRole('searchbox', { name: 'Search repositories' })).toHaveValue('hello')

  await page.getByRole('searchbox', { name: 'Search repositories' }).fill('')
  await expect(page).toHaveURL('/')
})

test('home page persists sort option in url query parameters', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveURL('/')

  await chooseSortOption(page, 'Forks')
  await expect(page).toHaveURL(sortForksRegex)

  await chooseSortOption(page, 'Plugins')
  await expect(page).toHaveURL(sortPluginsRegex)

  await chooseSortOption(page, 'Stars')
  await expect(page).toHaveURL('/')
})

test('home page restores state from url query parameters on load', async ({ page }) => {
  await page.goto('/?q=superpowers&sort=forks-desc')

  await expect(page.getByRole('searchbox', { name: 'Search repositories' })).toHaveValue('superpowers')
  await expect(page.getByRole('combobox', { name: 'Sort by' })).toHaveText(sortOptionForksRegex)
  await expect(page.getByRole('link', { name: 'View details for obra/superpowers' }).first()).toBeVisible()
})

test('home page restores invalid sort option from url query parameters to default', async ({ page }) => {
  await page.goto('/?q=superpowers&sort=invalid')

  await expect(page.getByRole('searchbox', { name: 'Search repositories' })).toHaveValue('superpowers')
  await expect(page.getByRole('combobox', { name: 'Sort by' })).toHaveText(sortOptionStarsRegex)
  await expect(page).toHaveURL('/?q=superpowers')
})

test('home page browser back and forward navigation restores persisted state', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('searchbox', { name: 'Search repositories' }).fill('superpowers')
  await expect(page).toHaveURL(qSuperpowersRegex)

  await chooseSortOption(page, 'Forks')
  await expect(page).toHaveURL(qSuperpowersSortForksRegex)

  await page.goBack()
  await expect(page).toHaveURL(qSuperpowersRegex)
  await expect(page.getByRole('searchbox', { name: 'Search repositories' })).toHaveValue('superpowers')
  await expect(page.getByRole('combobox', { name: 'Sort by' })).toHaveText(sortOptionStarsRegex)

  await page.goForward()
  await expect(page).toHaveURL(qSuperpowersSortForksRegex)
  await expect(page.getByRole('searchbox', { name: 'Search repositories' })).toHaveValue('superpowers')
  await expect(page.getByRole('combobox', { name: 'Sort by' })).toHaveText(sortOptionForksRegex)
})
