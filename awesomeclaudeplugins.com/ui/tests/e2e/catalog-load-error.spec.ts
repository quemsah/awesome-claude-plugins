import { expect, test } from '@playwright/test'

const detailsLinkName = /View details for /
const loadErrorText = 'Failed to load repositories. Please try again later'

test('a failed replacement disables pagination until the replacement is retried', async ({ page }) => {
  await page.goto('/')

  const firstResult = page.getByRole('link', { name: detailsLinkName }).first()
  await expect(firstResult).toBeVisible()

  let catalogRequests = 0
  await page.route('**/api/catalog*', async (route) => {
    catalogRequests += 1
    await route.fulfill({ status: 500 })
  })

  await page.getByRole('searchbox', { name: 'Search repositories' }).fill('superpowers')
  await expect(page.getByText(loadErrorText)).toBeVisible()
  expect(catalogRequests).toBe(1)

  // The retained cards belong to the previous query. Their pagination footer must not be allowed to
  // append page 1 of the failed replacement query onto that old result set.
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0)

  await page.waitForTimeout(500)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(500)

  expect(catalogRequests).toBe(1)
  await expect(firstResult).toBeVisible()
})

test('a failed replacement reports the error before the retained results', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('link', { name: detailsLinkName }).first()).toBeVisible()
  await page.route('**/api/catalog*', async (route) => {
    await route.fulfill({ status: 500 })
  })

  await page.getByRole('searchbox', { name: 'Search repositories' }).fill('superpowers')
  await expect(page.getByText(loadErrorText)).toBeVisible()

  const errorPrecedesGrid = await page.locator('body').evaluate((body) => {
    const error = [...body.querySelectorAll('p')].find(
      (element) => element.textContent === 'Failed to load repositories. Please try again later'
    )
    const grid = body.querySelector('#repo-results')
    return Boolean(error && grid && error.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING)
  })

  expect(errorPrecedesGrid).toBe(true)
})

test('a failed search from an empty result set can be retried', async ({ page }) => {
  let catalogRequests = 0
  await page.route('**/api/catalog*', async (route) => {
    catalogRequests += 1
    if (catalogRequests === 1) {
      await route.fulfill({ status: 500 })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ hasMore: false, pluginsCount: 0, repos: [], total: 0 }),
    })
  })
  await page.goto('/?q=definitely-no-matching-repository-name')

  const searchbox = page.getByRole('searchbox', { name: 'Search repositories' })
  const noMatches = page.getByText('No repositories match your search')
  await expect(noMatches).toBeVisible()
  await searchbox.fill('superpowers')

  await expect(page.getByText(loadErrorText)).toBeVisible()
  await expect(noMatches).toBeHidden()
  await page.getByRole('button', { name: 'Retry' }).click()

  await expect(noMatches).toBeVisible()
  expect(catalogRequests).toBe(2)
})
