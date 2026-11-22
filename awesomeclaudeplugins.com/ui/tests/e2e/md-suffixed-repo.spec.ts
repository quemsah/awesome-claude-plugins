import { expect, test } from '@playwright/test'

const mdSuffixedRepoUrl = '/sstklen/yes.md'
const mdSuffixedRepoHeading = 'yes.md'
const mdSuffixedMarkdownAlternatePattern = /\/sstklen\/yes\.md\.md$/
const mdSuffixedMarkdownTitle = 'title: "sstklen/yes.md"'
const ordinaryRepoMarkdownUrl = '/ykdojo/claude-code-tips.MD'
const ordinaryRepoMarkdownTitle = 'title: "ykdojo/claude-code-tips"'

test('serves the html page of a repository whose name ends in .md', async ({ page }) => {
  const response = await page.goto(mdSuffixedRepoUrl)

  expect(response?.status()).toBe(200)
  expect(response?.headers()['content-type']).toContain('text/html')
  await expect(page.getByRole('heading', { level: 1, name: mdSuffixedRepoHeading })).toBeVisible()
  await expect(page.locator('link[rel="alternate"][type="text/markdown"]')).toHaveAttribute('href', mdSuffixedMarkdownAlternatePattern)
})

test('serves that repository as markdown from the doubled suffix', async ({ request }) => {
  const response = await request.get(`${mdSuffixedRepoUrl}.md`)

  expect(response.ok()).toBe(true)
  expect(response.headers()['content-type']).toContain('text/markdown')
  expect(response.headers()['x-robots-tag']).toBe('noindex')
  expect(await response.text()).toContain(mdSuffixedMarkdownTitle)
})

test('keeps the negotiated Markdown representation separate from HTML in either request order', async ({ request }) => {
  for (const accept of ['text/html', 'text/markdown', 'text/html']) {
    const response = await request.get(mdSuffixedRepoUrl, { headers: { accept } })

    expect(response.ok()).toBe(true)
    expect(response.headers()['content-type']).toContain(accept)
    expect(response.headers()['cache-control']).toContain('no-store')
    expect(response.headers()['x-robots-tag']).toBeUndefined()
    if (accept === 'text/markdown') {
      expect(
        response
          .headers()
          .vary?.toLowerCase()
          .split(',')
          .map((header) => header.trim())
      ).toContain('accept')
      expect(await response.text()).toContain(mdSuffixedMarkdownTitle)
    }
  }
})

test('serves ordinary repository markdown with a case-insensitive suffix', async ({ request }) => {
  const response = await request.get(ordinaryRepoMarkdownUrl)

  expect(response.ok()).toBe(true)
  expect(response.headers()['content-type']).toContain('text/markdown')
  expect(await response.text()).toContain(ordinaryRepoMarkdownTitle)
})
