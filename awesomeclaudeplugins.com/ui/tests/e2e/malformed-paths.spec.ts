import { expect, test } from '@playwright/test'

// Exercise actual HTTP routing rather than calling proxy() directly. The framework,
// URL parser and matcher may normalize requests before the proxy sees them.
test('malformed traversal requests never produce a server error', async ({ request }) => {
  const malformedPaths = [
    '/..∕..∕..∕etc/passwd',
    '/..�..�..�etc/passwd',
    '/owner%2F..%2F..%2Fetc%2Fpasswd',
    '/owner%5C..%5Cetc%5Cpasswd',
    '/owner%EF%BF%BDrepo',
  ]

  for (const path of malformedPaths) {
    const response = await request.get(path, { maxRedirects: 0 })
    expect([400, 404], `Unexpected HTTP status for ${path}: ${response.status()}`).toContain(response.status())
  }
})

test('valid routes still work with the malformed-path guard enabled', async ({ request }) => {
  const response = await request.get('/about')
  expect(response.status()).toBe(200)
})
