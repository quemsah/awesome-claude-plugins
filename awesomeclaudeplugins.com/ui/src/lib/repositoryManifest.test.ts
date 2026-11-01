import { expect, it } from 'vitest'
import { loadRepositoryManifest, repositoryManifestErrorMessage } from './repositoryManifest.ts'

it.each(['.claude-plugin/marketplace.json', '.claude-plugin/plugin.json'])(
  'keeps an interrupted %s response distinct from invalid JSON',
  async (failedPath) => {
    const result = await loadRepositoryManifest(async (path) =>
      path !== failedPath
        ? new Response(null, { status: 404 })
        : new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new TypeError('Connection terminated while reading the body'))
              },
            })
          )
    )
    expect(result).toEqual({ kind: 'error', path: failedPath, reason: 'network' })
  }
)

it('loads a root plugin only after marketplace 404', async () => {
  const paths: string[] = []
  const result = await loadRepositoryManifest(async (path) => {
    paths.push(path)
    return path.endsWith('marketplace.json') ? new Response(null, { status: 404 }) : Response.json({ name: 'Review Tools' })
  })
  expect(paths).toEqual(['.claude-plugin/marketplace.json', '.claude-plugin/plugin.json'])
  expect(result).toMatchObject({ kind: 'standalone-plugin', manifest: { name: 'Review Tools' } })
})

it.each(['.claude-plugin/marketplace.json', '.claude-plugin/plugin.json'])('still rejects malformed JSON from %s', async (failedPath) => {
  const result = await loadRepositoryManifest(async (path) =>
    path === failedPath ? new Response('{"name":') : new Response(null, { status: 404 })
  )
  expect(result).toEqual({ kind: 'error', path: failedPath, reason: 'invalid-content' })
})

it.each([429, 503])('does not hide marketplace HTTP %s with a plugin fallback', async (status) => {
  let calls = 0
  const result = await loadRepositoryManifest(async () => {
    calls++
    return new Response(null, { status })
  })
  expect(result).toMatchObject({ kind: 'error', reason: 'http', status })
  expect(calls).toBe(1)
})

it('keeps an invalid marketplace distinct from a missing manifest', async () => {
  expect(await loadRepositoryManifest(async () => Response.json({ name: 'not-a-marketplace' }))).toMatchObject({
    kind: 'error',
    reason: 'invalid-content',
  })
  expect(await loadRepositoryManifest(async () => new Response(null, { status: 404 }))).toEqual({ kind: 'missing' })
})

it.each([
  ['.claude-plugin/marketplace.json', 'marketplace'],
  ['.claude-plugin/plugin.json', 'plugin'],
] as const)('reports the actual %s manifest for HTTP and content errors', (path, name) => {
  expect(repositoryManifestErrorMessage({ kind: 'error', path, reason: 'http', status: 429 })).toContain(
    `Failed to load ${name} manifest due to a request limit`
  )
  expect(repositoryManifestErrorMessage({ kind: 'error', path, reason: 'http', status: 503 })).toContain(`Failed to load ${name} manifest.`)
  expect(repositoryManifestErrorMessage({ kind: 'error', path, reason: 'invalid-content' })).toBe(
    `${name === 'plugin' ? 'Plugin' : 'Marketplace'} manifest contains invalid data.`
  )
})
