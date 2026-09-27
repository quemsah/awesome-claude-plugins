import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { MARKETPLACE_INVALID_CONTENT_CACHE_VERSION } from './marketplace.js'

const PARSER_BLOB_SHA_BY_CACHE_VERSION: Readonly<Record<number, string>> = {
  2: '0f7a59eeeef7b41bf726b0c37f17708af9658bef',
}

function gitBlobSha(content: Buffer): string {
  return createHash('sha1').update(`blob ${content.byteLength}\0`).update(content).digest('hex')
}

it('requires an invalid-content cache version bump when marketplace parsing semantics change', () => {
  expect(Number.isSafeInteger(MARKETPLACE_INVALID_CONTENT_CACHE_VERSION)).toBe(true)
  expect(MARKETPLACE_INVALID_CONTENT_CACHE_VERSION).toBeGreaterThanOrEqual(1)

  const parserPath = new URL('./marketplace.ts', import.meta.url)
  const actualSha = gitBlobSha(readFileSync(parserPath))
  const expectedSha = PARSER_BLOB_SHA_BY_CACHE_VERSION[MARKETPLACE_INVALID_CONTENT_CACHE_VERSION]

  expect(
    expectedSha,
    'Bump MARKETPLACE_INVALID_CONTENT_CACHE_VERSION and add the parser blob SHA when marketplace parsing semantics change.',
  ).toBeDefined()
  expect(actualSha).toBe(expectedSha)
})
