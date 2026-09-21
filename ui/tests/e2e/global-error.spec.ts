import { expect, type Page, test } from '@playwright/test'

const errorHeading = 'Something went wrong'
const themeStorageKey = 'theme-preference'

type StoredTheme = 'light' | 'dark'

type CrashOptions = {
  clearAppliedThemeBeforeCrash?: boolean
}

// next-themes reads `window.matchMedia` while the root layout subtree renders, so breaking that API crashes
// hydration above `app/error.tsx`. Only `global-error.tsx` can catch it. Clearing the already-applied theme
// immediately before the throw simulates a root-layout failure that happened before next-themes decorated <html>.
async function crashRootLayout(page: Page, storedTheme: StoredTheme, options: CrashOptions = {}) {
  await page.addInitScript(
    ({ clearAppliedThemeBeforeCrash, key, theme }) => {
      localStorage.setItem(key, theme)
      const matchMedia = window.matchMedia.bind(window)
      window.matchMedia = (query: string) => {
        if (query.includes('prefers-color-scheme')) {
          if (clearAppliedThemeBeforeCrash) {
            document.documentElement.classList.remove('light', 'dark')
            document.documentElement.style.removeProperty('color-scheme')
          }
          throw new Error('e2e: forced global-error render')
        }
        return matchMedia(query)
      }
    },
    {
      clearAppliedThemeBeforeCrash: options.clearAppliedThemeBeforeCrash ?? false,
      key: themeStorageKey,
      theme: storedTheme,
    }
  )

  await page.goto('/')
  await expect(page.getByRole('heading', { name: errorHeading })).toBeVisible()
}

async function storeTheme(page: Page, storedTheme: StoredTheme) {
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

  test(`global error falls back to stored ${storedTheme} when no active theme can be copied`, async ({ page }) => {
    await crashRootLayout(page, storedTheme, { clearAppliedThemeBeforeCrash: true })

    const errorTheme = await themeState(page)
    expect(errorTheme.rootClass).toContain(storedTheme)
    expect(errorTheme.colorScheme).toBe(storedTheme)
    expect(errorTheme.background).not.toBe('')
  })
}

test('global error renders with its own global styles', async ({ page }) => {
  await crashRootLayout(page, 'dark', { clearAppliedThemeBeforeCrash: true })

  const styled = await page.evaluate(() => {
    const main = document.querySelector('main')
    if (!main) return null
    const style = getComputedStyle(main)
    return {
      background: getComputedStyle(document.body).getPropertyValue('--background').trim(),
      display: style.display,
      padding: style.padding,
      minHeight: style.minHeight,
    }
  })

  expect(styled).toMatchObject({ display: 'flex', padding: '16px' })
  expect(styled?.background).not.toBe('')
  expect(Number.parseFloat(styled?.minHeight ?? '0')).toBeGreaterThan(0)
})
