import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { MARKETPLACE_CONTRACT_VERSION } from '@awesome-claude-plugins/marketplace-contract'
import { expect, it } from 'vitest'

const CONTRACT_BLOB_SHA_BY_VERSION: Readonly<Record<number, string>> = {
  1: 'a3607a7c2cafc0675ff4be8c6d0c846ac134c001',
}

function gitBlobSha(content: Buffer): string {
  return createHash('sha1')
    .update(`blob ${content.byteLength}\0`)
    .update(content)
    .digest('hex')
}

it('requires a marketplace parser version bump when the contract implementation changes', () => {
  expect(Number.isSafeInteger(MARKETPLACE_CONTRACT_VERSION)).toBe(true)
  expect(MARKETPLACE_CONTRACT_VERSION).toBeGreaterThanOrEqual(1)

  const contractPath = new URL('../../marketplace-contract/index.js', import.meta.url)
  const actualSha = gitBlobSha(readFileSync(contractPath))
  const expectedSha = CONTRACT_BLOB_SHA_BY_VERSION[MARKETPLACE_CONTRACT_VERSION]

  expect(
    expectedSha,
    'Bump MARKETPLACE_CONTRACT_VERSION and add its new Git blob SHA when marketplace validation semantics change.',
  ).toBeDefined()
  expect(actualSha).toBe(expectedSha)
})
