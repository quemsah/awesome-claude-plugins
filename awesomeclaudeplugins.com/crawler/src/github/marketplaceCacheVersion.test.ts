import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { MARKETPLACE_INVALID_CONTENT_CACHE_VERSION } from './marketplace.js'

const PARSER_BLOB_SHA_BY_CACHE_VERSION: Readonly<Record<number, string>> = {
  3: '8b813b589fb7fe694d8f694bcb1b2311a22e3f26',
  4: '4ae2b4d6e549da696f9c1c2450ebc128b7cb05fc',
  5: 'f90f582605472db5adc2728dd789843fcc320471',
  6: '42a1223f4233f4a0fa923d6f66eaefae25780706',
  7: '101a3a2da595897b0e96a1c869407a09758deeff',
  8: '0ee9b64a9ac8dbb147b8a0ec6ad47506161145f9',
}

function gitBlobSha(content: Buffer): string {
  const normalized = Buffer.from(content.toString('utf8').replace(/\r\n/g, '\n'))
  return createHash('sha1')
    .update(`blob ${normalized.byteLength}${String.fromCharCode(0)}`)
    .update(normalized)
    .digest('hex')
}

it('requires an invalid-content cache version bump when marketplace parsing semantics change', () => {
  expect(Number.isSafeInteger(MARKETPLACE_INVALID_CONTENT_CACHE_VERSION)).toBe(true)
  expect(MARKETPLACE_INVALID_CONTENT_CACHE_VERSION).toBeGreaterThanOrEqual(1)

  const parserPath = new URL('../../../shared/catalog-contract/src/marketplace.js', import.meta.url)
  const actualSha = gitBlobSha(readFileSync(parserPath))
  const expectedSha = PARSER_BLOB_SHA_BY_CACHE_VERSION[MARKETPLACE_INVALID_CONTENT_CACHE_VERSION]

  expect(
    expectedSha,
    'Bump MARKETPLACE_INVALID_CONTENT_CACHE_VERSION and add the parser blob SHA when marketplace parsing semantics change.',
  ).toBeDefined()
  expect(actualSha).toBe(expectedSha)
})
