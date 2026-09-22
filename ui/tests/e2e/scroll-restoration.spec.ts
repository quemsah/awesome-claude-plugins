import { expect, type Page, test } from '@playwright/test'

const detailsLinkName = /View details for /
const backToRepositoriesName = /Back to all repositories/

function scrollY(page: Page) {
  return page.evaluate(() => window.scrollY)
}

function storedScrollPositions(page: Page) {
  return page.evaluate(() => JSON.parse(window.sessionStorage.getItem('catalog-scroll-positions') ?? '{}') as Record<string, number>)
}

async function scrollToOffset(page: Page, offset: number) {
  await page.evaluate((target) => window.scrollTo(0, target), offset)
  await expect.poll(() => scrollY(page)).toBe(offset)
}

/**
 * Playwright scrolls a target into view before clicking it, which would move the very offset these
 * tests assert on, so the navigation is dispatched from the DOM instead.
 */
async function openDetailWithoutScrolling(page: Page, index: number) {
  await page.evaluate((target) => {
    document.querySelectorAll<HTMLAnchorElement>('a[aria-label^="View details for "]')[target]?.click()
  }, index)
  await expect(page).not.toHaveURL('/')
}

/**
 * `click()` scrolls the button into view first, and arriving at the end of the list is itself a way to
 * load a page, so a test that wants exactly one more page has to dispatch the click from the DOM.
 */
async function clickLoadMoreWithoutScrolling(page: Page) {
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('#repo-results > div > button')?.click()
  })
}

async function expectRestored(page: Page, offset: number) {
  await expect
    .poll(
      () =>
        page.evaluate((savedOffset) => {
          const maximumScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
          return Math.abs(window.scrollY - Math.min(savedOffset, maximumScroll))
        }, offset),
      { timeout: 10_000 }
    )
    .toBeLessThanOrEqual(5)
}

test('browser Back keeps the catalog scroll position', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: detailsLinkName }).first()).toBeVisible()

  await scrollToOffset(page, 1_000)
  await openDetailWithoutScrolling(page, 6)

  await page.goBack()
  await expect(page).toHaveURL('/')
  await expectRestored(page, 1_000)
})

test('browser Back keeps an offset held past the first lazily loaded catalog page', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: detailsLinkName }).first()).toBeVisible()

  await clickLoadMoreWithoutScrolling(page)
  await expect(page.getByRole('link', { name: detailsLinkName })).toHaveCount(48)

  await scrollToOffset(page, 2_400)
  await openDetailWithoutScrolling(page, 30)

  await page.goBack()
  await expect(page).toHaveURL('/')
  await expectRestored(page, 2_400)
})

test('the offset is captured from the interaction that starts the navigation', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: detailsLinkName }).first()).toBeVisible()

  await scrollToOffset(page, 1_000)
  await openDetailWithoutScrolling(page, 6)

  // Committing the repository page scrolls the outgoing list segment towards the top, so a position
  // read from the resulting scroll events would be smaller than the one the visitor was reading at.
  await expect.poll(() => scrollY(page)).toBeLessThan(1_000)
  await expect.poll(() => storedScrollPositions(page)).toHaveProperty('/', 1_000)
})

test('"Back to all repositories" returns to the searched list at the offset the visitor left', async ({ page }) => {
  await page.goto('/?q=superpowers')
  await expect(page.getByRole('searchbox', { name: 'Search repositories' })).toHaveValue('superpowers')
  await expect(page.getByRole('link', { name: detailsLinkName }).first()).toBeVisible()

  const offset = await page.evaluate(() => Math.round((document.documentElement.scrollHeight - window.innerHeight) / 2))
  expect(offset).toBeGreaterThan(0)
  await scrollToOffset(page, offset)

  await page.goto('/ykdojo/claude-code-tips')
  await expect(page.getByRole('heading', { name: 'claude-code-tips' })).toBeVisible()

  await page.getByRole('link', { name: backToRepositoriesName }).click()
  await expect(page).toHaveURL('/?q=superpowers')
  await expectRestored(page, offset)
})

test('an offset stored for one search state is not applied to another', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: detailsLinkName }).first()).toBeVisible()

  await scrollToOffset(page, 1_000)
  await openDetailWithoutScrolling(page, 6)
  await page.goBack()
  await expectRestored(page, 1_000)

  await page.goto('/?q=claude')
  await expect(page.getByRole('link', { name: detailsLinkName }).first()).toBeVisible()
  await expect.poll(() => scrollY(page)).toBe(0)
})