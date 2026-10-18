import { expect, type Page, test } from '@playwright/test'

async function chooseSortOption(page: Page, optionName: 'Stars' | 'Forks' | 'Plugins') {
  await page.getByRole('combobox', { name: 'Sort by' }).click()
  await page.getByRole('option', { name: optionName }).click()
}

/** A retried assertion passes on its first match, so a late timer that overwrites a settled state
 * needs a hold window instead. */
async function expectStable<T extends Record<string, unknown>>(read: () => Promise<T>, expected: T, holdMs: number) {
  const deadline = Date.now() + holdMs
  do {
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(await read()).toEqual(expected)
  } while (Date.now() < deadline)
}

test('url, sort control, and catalog results stay aligned when sort is chosen mid-debounce', async ({ page }) => {
  const catalogSorts: (string | null)[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/catalog')) {
      catalogSorts.push(new URL(request.url()).searchParams.get('sort'))
    }
  })

  const searchbox = page.getByRole('searchbox', { name: 'Search repositories' })
  const combobox = page.getByRole('combobox', { name: 'Sort by' })
  const screenState = async () => ({
    // Compared as a parameter map: whichever write commits first decides whether the url reads
    // `q=...&sort=...` or the other way around.
    urlParams: Object.fromEntries(new URL(page.url()).searchParams),
    searchInput: await searchbox.inputValue(),
    sortControl: await combobox.innerText(),
    resultsSortedBy: catalogSorts[catalogSorts.length - 1] ?? null,
  })
  const alignedState: Awaited<ReturnType<typeof screenState>> = {
    urlParams: { q: 'superpowers', sort: 'forks-desc' },
    searchInput: 'superpowers',
    sortControl: 'Forks',
    resultsSortedBy: 'forks-desc',
  }

  await page.goto('/')
  await searchbox.fill('superpowers')

  // The search box, the sort control and the address bar each settle on their own debounce, so
  // this watches all three. The 250 ms input debounce registers the term just after the lead-in
  // and queues a url write 500 ms later; choosing a sort option in between races that write.
  await page.waitForTimeout(400)
  await chooseSortOption(page, 'Forks')

  await expect.poll(screenState, { timeout: 10_000 }).toEqual(alignedState)
  await expectStable(screenState, alignedState, 2_000)
})


test('reversing sort before an earlier URL navigation settles restores the correct address', async ({ page }) => {
  await page.goto('/')
  await page.route(/_rsc=/, async (route) => {
    if (new URL(route.request().url()).searchParams.get('sort') === 'forks-desc') {
      await new Promise((resolve) => setTimeout(resolve, 900))
    }
    await route.continue()
  })

  await chooseSortOption(page, 'Forks')
  await chooseSortOption(page, 'Stars')

  const screenState = async () => ({
    sortParam: new URL(page.url()).searchParams.get('sort'),
    selectedSort: await page.getByRole('combobox', { name: 'Sort by' }).innerText(),
  })
  const expected = { sortParam: null, selectedSort: 'Stars' }
  await expect.poll(screenState).toEqual(expected)
  await expectStable(screenState, expected, 1_500)
})

test('a header link clears an abandoned search navigation and queued input', async ({ page }) => {
  await page.goto('/?q=previous')
  await page.route(/_rsc=/, async (route) => {
    if (new URL(route.request().url()).searchParams.get('q') === 'replacement') {
      await new Promise((resolve) => setTimeout(resolve, 900))
    }
    await route.continue()
  })

  const pendingSearchRequest = page.waitForRequest(
    (request) => request.url().includes('_rsc=') && new URL(request.url()).searchParams.get('q') === 'replacement'
  )
  const searchbox = page.getByRole('searchbox', { name: 'Search repositories' })
  await searchbox.fill('replacement')
  await pendingSearchRequest
  await page.getByRole('link', { name: 'Search repositories' }).click()

  const screenState = async () => ({
    queryParam: new URL(page.url()).searchParams.get('q'),
    searchInput: await searchbox.inputValue(),
  })
  const expected = { queryParam: null, searchInput: '' }
  await expect.poll(screenState).toEqual(expected)
  await expectStable(screenState, expected, 1_500)
})
