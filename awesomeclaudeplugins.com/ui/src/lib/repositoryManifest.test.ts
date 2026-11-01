import { expect, it } from 'vitest'
import { loadRepositoryManifest } from './repositoryManifest.ts'

it('loads a root plugin only after marketplace 404', async () => {
  const paths: string[] = []
  const result = await loadRepositoryManifest(async (path) => {
    paths.push(path)
    return path.endsWith('marketplace.json') ? new Response(null, { status: 404 }) : Response.json({ name: 'Review Tools' })
  })
  expect(paths).toEqual(['.claude-plugin/marketplace.json', '.claude-plugin/plugin.json'])
  expect(result).toMatchObject({ kind: 'standalone-plugin', manifest: { name: 'Review Tools' } })
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
