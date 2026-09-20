import { expect, type Page, test } from '@playwright/test'
import { CATALOG_PAGE_SIZE } from '../../src/lib/catalogPagination.ts'

const browseHeading = 'Browse Claude Code plugin repositories'
const homeHeading = 'Awesome Claude Plugins'
const paginationName = 'Catalog pagination'
const previousPageName = 'Previous page'
const nextPageName = 'Next page'
const pageCounterPattern = /^Page (\d+) of (\d+)$/
const pageThreeCounterPattern = /^Page 3 of \d+$/
const browsePageThreeUrlPattern = /\/browse\/3$/
const browseCanonicalUrl = 'https://awesomeclaudeplugins.com/browse/2'

function cardItems(page: Page) {
  return page.locator('main ul > li')
}

async function reportedPageCount(page: Page) {
  const counter = await page.getByText(pageCounterPattern).first().textContent()
  return Number(pageCounterPattern.exec(counter ?? '')?.[2])
}

test('browse page 1 permanently redirects to the home page', async ({ page, request }) => {
  const response = await request.get('/browse/1', { maxRedirects: 0 })

  expect(response.status()).toBe(308)
  expect(response.headers().location).toBe('/')

  await page.goto('/browse/1')
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: homeHeading })).toBeVisible()
})

test('browse page 2 renders a full page of repository cards', async ({ page }) => {
  const response = await page.goto('/browse/2')

  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { name: browseHeading })).toBeVisible()
  await expect(cardItems(page)).toHaveCount(CATALOG_PAGE_SIZE)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', browseCanonicalUrl)
})

test('browse pagination links pair adjacent pages and navigate', async ({ page }) => {
  await page.goto('/browse/2')

  const pagination = page.getByRole('navigation', { name: paginationName })
  await expect(pagination.getByRole('link', { name: previousPageName })).toHaveAttribute('href', '/browse/1')
  await expect(pagination.getByRole('link', { name: nextPageName })).toHaveAttribute('href', '/browse/3')

  await pagination.getByRole('link', { name: nextPageName }).click()
  await expect(page).toHaveURL(browsePageThreeUrlPattern)
  await expect(page.getByText(pageThreeCounterPattern)).toBeVisible()
  await expect(cardItems(page)).toHaveCount(CATALOG_PAGE_SIZE)
})

test('browse last page has no next link', async ({ page }) => {
  await page.goto('/browse/2')
  const lastPage = await reportedPageCount(page)

  const response = await page.goto(`/browse/${lastPage}`)

  expect(response?.status()).toBe(200)
  await expect(page.getByText(new RegExp(`^Page ${lastPage} of ${lastPage}$`))).toBeVisible()

  const pagination = page.getByRole('navigation', { name: paginationName })
  await expect(pagination.getByRole('link', { name: nextPageName })).toHaveCount(0)
  await expect(pagination.getByRole('link', { name: previousPageName })).toHaveAttribute('href', `/browse/${lastPage - 1}`)

  const cards = await cardItems(page).count()
  expect(cards).toBeGreaterThan(0)
  expect(cards).toBeLessThanOrEqual(CATALOG_PAGE_SIZE)
})

test('browse unparseable page number returns 404', async ({ page }) => {
  for (const path of ['/browse/abc', '/browse/0', '/browse/2-5']) {
    const response = await page.goto(path)

    expect(response?.status(), path).toBe(404)
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible()
  }
})

test('browse page beyond the last page returns 404', async ({ page }) => {
  const response = await page.goto('/browse/99999')

  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible()
})
