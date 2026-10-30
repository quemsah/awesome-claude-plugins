import type { Page } from '@playwright/test'

export async function mockClipboard(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: () => Promise.resolve((globalThis as typeof globalThis & { __copiedText?: string }).__copiedText ?? ''),
        writeText: (text: string) => {
          ;(globalThis as typeof globalThis & { __copiedText?: string }).__copiedText = text
          return Promise.resolve()
        },
      },
    })
  })
}

export async function copiedText(page: Page) {
  return page.evaluate(() => (globalThis as typeof globalThis & { __copiedText?: string }).__copiedText ?? '')
}
