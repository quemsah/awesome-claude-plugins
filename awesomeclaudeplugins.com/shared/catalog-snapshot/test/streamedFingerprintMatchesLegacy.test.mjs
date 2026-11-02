import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { calculateCatalogFingerprint } from '../src/fingerprint.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const fixturesDir = join(__dirname, '../../fixtures/catalog-snapshot/v1')
const inputRepos = JSON.parse(readFileSync(join(fixturesDir, 'input-repos.json'), 'utf8'))

describe('streamedFingerprintMatchesLegacy', () => {
  it('calculates the exact SHA-256 fingerprint as legacy JSON.stringify streaming', () => {
    // Legacy algorithm from ui/src/app/api/catalog-version/route.ts
    const legacyFingerprint = createHash('sha256')
      .update(JSON.stringify(inputRepos))
      .digest('hex')

    // Streamed algorithm accepting objects
    const streamedFromObjects = calculateCatalogFingerprint(inputRepos)
    assert.equal(streamedFromObjects, legacyFingerprint)

    // Streamed algorithm accepting pre-serialized JSON strings
    const serializedStrings = inputRepos.map((r) => JSON.stringify(r))
    const streamedFromStrings = calculateCatalogFingerprint(serializedStrings)
    assert.equal(streamedFromStrings, legacyFingerprint)
  })
})
