import { expect, test } from '@playwright/test'

test('stats HTML is not cached across deployments', async ({ request }) => {
  const response = await request.get('/stats')

  expect(response.ok()).toBe(true)

  const cacheControl = response.headers()['cache-control'] ?? ''
  expect(cacheControl).toContain('no-store')
  expect(cacheControl).not.toContain('s-maxage')
})
