import { expect, type Page, test } from '@playwright/test'

const errorHeading = 'Something went wrong'
const themeStorageKey = 'theme-preference'

// next-themes reads `window.matchMedia` while the root layout subtree renders, so breaking that API crashes
// hydration above `app/error.tsx`. Only `global-error.tsx` can catch it, and that component replaces the
// `<html>` element `app/layout.tsx` produced, which is where the theme class and `color-scheme` live.
async function crashRootLayout(page: Page, storedTheme: 'light' | 'dark') {
  await page.addInitScript(
    ([theme, key]) => {
      localStorage.setItem(key, theme)
      const matchMedia = window.matchMedia.bind(window)
      window.matchMedia = (query: string) => {
        if (query.includes('prefers-color-scheme')) throw new Error('e2e: forced global-error render')
        return matchMedia(query)
      }
    },
    [storedTheme, themeStorageKey] as const
  )

  await page.goto('/')
  await expect(page.getByRole('heading', { name: errorHeading })).toBeVisible()
}

async function storeTheme(page: Page, storedTheme: 'light' | 'dark') {
  await page.addInitScript(([theme, key]) => localStorage.setItem(key, theme), [storedTheme, themeStorageKey] as const)
}

function themeState(page: Page) {
  return page.evaluate(() => ({
    rootClass: document.documentElement.className,
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    background: getComputedStyle(document.body).getPropertyValue('--background').trim(),
  }))
}

for (const storedTheme of ['dark', 'light'] as const) {
  test(`global error keeps the ${storedTheme} theme that was active before the crash`, async ({ page }) => {
    await storeTheme(page, storedTheme)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Awesome Claude Plugins' })).toBeVisible()
    const healthyTheme = await themeState(page)

    await crashRootLayout(page, storedTheme)

    expect(healthyTheme.rootClass).toContain(storedTheme)
    expect(await themeState(page)).toEqual(healthyTheme)
  })
}

test('global error keeps the stylesheet that the root layout loads', async ({ page }) => {
  await crashRootLayout(page, 'dark')

  const styled = await page.evaluate(() => {
    const main = document.querySelector('main')
    if (!main) return null
    const style = getComputedStyle(main)
    return {
      sheets: document.querySelectorAll('link[rel="stylesheet"]').length,
      display: style.display,
      padding: style.padding,
      minHeight: style.minHeight,
    }
  })

  // `flex p-4 min-h-dvh` on <main> only resolve from the Tailwind sheet `app/layout.tsx` imports.
  expect(styled).toMatchObject({ display: 'flex', padding: '16px' })
  expect(styled?.sheets ?? 0).toBeGreaterThan(0)
  expect(Number.parseFloat(styled?.minHeight ?? '0')).toBeGreaterThan(0)
})
