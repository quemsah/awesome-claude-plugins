import { expect, test } from '@playwright/test'

const detailsLinkName = /View details for /

type CatalogRaceProbe = {
  calls: string[]
  staleCallbackInvoked: boolean
}

test('a stale pagination callback cannot preempt a replacement before pending load renders', async ({ page }) => {
  await page.goto('/')

  const detailsLinks = page.getByRole('link', { name: detailsLinkName })
  await expect(detailsLinks).toHaveCount(24)

  await page.evaluate(() => {
    const nativeFetch = window.fetch.bind(window)
    const probe: CatalogRaceProbe = { calls: [], staleCallbackInvoked: false }
    ;(window as Window & { __catalogRaceProbe?: CatalogRaceProbe }).__catalogRaceProbe = probe

    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const url = new URL(requestUrl, window.location.href)

      if (url.pathname === '/api/catalog') {
        probe.calls.push(url.search)

        if (!probe.staleCallbackInvoked && url.searchParams.get('q') === 'hello' && url.searchParams.get('page') === '0') {
          const loadMoreButton = document.querySelector<HTMLButtonElement>('#repo-results > div > button')
          if (loadMoreButton === null || loadMoreButton.disabled) {
            throw new Error('Expected enabled pagination button to be available')
          }
          loadMoreButton.click()
          probe.staleCallbackInvoked = true
        }
      }

      return nativeFetch(input, init)
    }) as typeof window.fetch
  })

  const loadStatus = page.locator('#repo-results > p[role="status"]')
  await page.getByRole('searchbox', { name: 'Search repositories' }).fill('hello')
  await expect(loadStatus).toHaveText('Repository results updated.')

  const probe = await page.evaluate(() => (window as Window & { __catalogRaceProbe?: CatalogRaceProbe }).__catalogRaceProbe)
  expect(probe?.staleCallbackInvoked).toBe(true)

  const helloPages = (probe?.calls ?? [])
    .map((search) => new URLSearchParams(search))
    .filter((params) => params.get('q') === 'hello')
    .map((params) => params.get('page'))

  expect(helloPages).toEqual(['0'])
})
