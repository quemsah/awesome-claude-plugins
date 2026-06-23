import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import packageJson from '../package.json' with { type: 'json' }
import { validateCatalog } from '../scripts/validate-catalog.mjs'

describe('local setup contract', () => {
  it('declares the expected package manager and Node engine', () => {
    assert.equal(packageJson.packageManager, 'npm@10.8.2')
    assert.equal(packageJson.engines.node, '24')
  })

  it('validates matching catalog sizes', () => {
    assert.deepEqual(validateCatalog({ repos: [{ id: 1 }], stats: [{ size: 1 }] }), [])
  })

  it('rejects stale catalog stats', () => {
    assert.deepEqual(validateCatalog({ repos: [{ id: 1 }, { id: 2 }], stats: [{ size: 1 }] }), [
      'latest stats size must match repository count 2',
    ])
  })
})
