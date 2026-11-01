/** biome-ignore-all lint/style/useNamingConvention: Fixtures use the public catalog and manifest field names. */
import { expect, test } from '@playwright/test'
import { copiedText, mockClipboard } from './helpers.ts'

const pluginName = 'Nebula Review Tools'
const pluginPath = '**/acme/capsule/HEAD/.claude-plugin/plugin.json'
const marketplacePath = '**/acme/capsule/HEAD/.claude-plugin/marketplace.json'
const description = 'Nebula review automation provides precise, independent change summaries for plugin authors and maintainers.'
const pluginManifestUrl = /\/HEAD\/\.claude-plugin\/plugin\.json$/
const pluginJsonUrl = /\/plugin\.json$/

test('finds standalone summaries through the real catalog and opens local loading', async ({ page, request }, testInfo) => {
  for (const query of ['Nebula', 'independent change summaries']) {
    const response = await request.get('/api/catalog', { params: { q: query } })
    expect(response.ok()).toBe(true)
    const data = await response.json()
    expect(data.total).toBe(1)
    expect(data.repos[0]).toMatchObject({
      owner: 'acme',
      repo_name: 'capsule',
      plugins_count: 1,
      manifest_kind: 'standalone-plugin',
      plugins: [{ name: pluginName, description }],
    })
  }
  const cards = await (await request.get('/api/catalog?q=Nebula&view=cards')).json()
  expect(cards.repos[0].manifest_kind).toBe('standalone-plugin')
  expect(cards.repos[0].plugins).toBeUndefined()
  await mockClipboard(page)
  await page.goto('/')
  await page.getByRole('searchbox', { name: 'Search repositories' }).fill('Nebula')
  const details = page.getByRole('link', { name: 'View details for acme/capsule' })
  await expect(details).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy marketplace command' })).toHaveCount(0)
  await details.click()
  await expect(page.getByRole('heading', { name: pluginName })).toBeVisible()
  await expect(page.locator('article')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Load locally' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'View plugin.json' })).toHaveAttribute('href', pluginManifestUrl)
  await expect(page.getByRole('link', { name: 'Open source repository acme/capsule in a new tab' })).toHaveAttribute(
    'href',
    'https://github.com/acme/capsule'
  )
  await expect(page.getByRole('link', { name: 'Open ./commands/review.md in a new tab' })).toHaveAttribute(
    'href',
    'https://github.com/acme/capsule/blob/trunk/commands/review.md'
  )
  await expect(page.getByRole('link', { name: "Read the author's instructions" })).toHaveAttribute(
    'href',
    'https://github.com/acme/capsule#readme'
  )
  await expect(page.getByText('/plugin install', { exact: false })).toHaveCount(0)
  await page.getByRole('button', { name: 'Copy local loading instructions' }).click()
  await expect.poll(() => copiedText(page)).toBe('git clone https://github.com/acme/capsule.git ./capsule\nclaude --plugin-dir ./capsule')
  await page.screenshot({ path: testInfo.outputPath('standalone-catalog.png'), fullPage: true })
})

test('retains standalone identity during live GitHub failures', async ({ page }, testInfo) => {
  await page.route('**/repos/acme/capsule', (route) => route.fulfill({ status: 503, body: '{}' }))
  await page.route(pluginPath, (route) => route.abort('failed'))
  await page.goto('/acme/capsule')
  await expect(page.getByRole('heading', { name: pluginName })).toBeVisible()
  await expect(page.getByText('Live plugin data is temporarily unavailable. Showing the latest catalog snapshot.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Load locally' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'View plugin.json' })).toHaveAttribute('href', pluginJsonUrl)
  await expect(page.getByText('/plugin install', { exact: false })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('standalone-snapshot.png'), fullPage: true })
})

test('shows plugin JSON errors instead of silently using the stored snapshot', async ({ page }) => {
  await page.route(pluginPath, (route) => route.fulfill({ contentType: 'application/json', body: '{"name":' }))
  await page.goto('/acme/capsule')
  await expect(page.getByRole('alert').filter({ hasText: 'Plugin manifest contains invalid data.' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'View plugin.json' })).toHaveAttribute('href', pluginJsonUrl)
  await expect(page.getByRole('heading', { name: 'Load locally' })).toHaveCount(0)
})

test('prefers a newly added marketplace and recovers standalone loading after removal', async ({ page }) => {
  await page.route(marketplacePath, (route) =>
    route.fulfill({
      json: { name: 'release-hub', owner: { name: 'acme' }, plugins: [{ name: 'market-helper', source: './' }] },
    })
  )
  let pluginRequests = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/.claude-plugin/plugin.json')) pluginRequests++
  })
  await page.goto('/acme/capsule')
  await expect(page.getByText('/plugin install market-helper@release-hub', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Load locally' })).toHaveCount(0)
  expect(pluginRequests).toBe(0)
  await page.unroute(marketplacePath)
  await page.reload()
  await expect(page.getByRole('heading', { name: pluginName })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Load locally' })).toBeVisible()
  await expect(page.getByText('/plugin install', { exact: false })).toHaveCount(0)
})

test('keeps one-plugin marketplaces distinct and publishes standalone machine surfaces', async ({ page, request }) => {
  const marketplace = await (await request.get('/api/catalog?q=market-hub')).json()
  expect(marketplace.repos[0].plugins_count).toBe(1)
  expect(marketplace.repos[0].manifest_kind).toBeUndefined()
  await page.goto('/acme/market-hub')
  await expect(page.getByText('/plugin install market-helper@market-hub', { exact: true })).toBeVisible()
  const html = await (await request.get('/acme/capsule')).text()
  expect(html).toContain(`<meta name="description" content="${description}"`)
  const markdown = await (await request.get('/acme/capsule.md')).text()
  expect(markdown).toContain('manifest_kind: "standalone-plugin"')
  expect(markdown).toContain('install_command: null')
  expect(markdown).toContain('claude --plugin-dir ./capsule')
  expect(markdown).not.toContain('/plugin marketplace add')
  const sitemap = await (await request.get('/sitemap/0')).text()
  expect(sitemap).toContain('/acme/capsule</loc>')
  expect(sitemap).toContain('/acme/market-hub</loc>')
})
