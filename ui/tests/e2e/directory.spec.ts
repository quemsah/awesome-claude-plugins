import { expect, test } from 'playwright/test'

const pluginsAvailableText = /plugins available across/i
const last30DaysChartText = /Last 30 days - Daily repository count/i

test('home page supports search and sort controls', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Awesome Claude Plugins' })).toBeVisible()

  await page.getByRole('searchbox', { name: 'Search repositories' }).fill('superpowers')
  await expect(page.getByRole('link', { name: 'View details for obra/superpowers' })).toBeVisible()

  await page.getByRole('combobox', { name: 'Sort by' }).click()
  await page.getByRole('option', { name: 'Plugins' }).click()
  await expect(page.getByText(pluginsAvailableText)).toBeVisible()
})

test('stats page supports time range filtering', async ({ page }) => {
  await page.goto('/stats')

  await expect(page.getByRole('heading', { name: 'Repositories Statistics' })).toBeVisible()

  await page.getByRole('combobox').click()
  await page.getByRole('option', { name: 'Last 30 days' }).click()
  await expect(page.getByText(last30DaysChartText)).toBeVisible()
})
