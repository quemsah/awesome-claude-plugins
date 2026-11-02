import { createHash } from 'node:crypto'

/**
 * Streaming SHA-256 calculator matching legacy JSON.stringify(records) byte-for-byte.
 * Compatible with array-of-objects streaming and pre-serialized JSON strings.
 */
export function createCatalogFingerprintHasher() {
  const hash = createHash('sha256')
  let first = true
  hash.update('[')

  return {
    updateRecord(recordOrJson) {
      if (!first) {
        hash.update(',')
      }
      first = false
      if (typeof recordOrJson === 'string') {
        hash.update(recordOrJson)
      } else {
        hash.update(JSON.stringify(recordOrJson))
      }
    },
    digest() {
      hash.update(']')
      return hash.digest('hex')
    },
  }
}

/**
 * Calculates the exact catalog fingerprint from an iterable of records or serialized JSON strings.
 * @param {Iterable<import('./index.d.ts').CatalogRecord | string>} records
 * @returns {string} SHA-256 hex digest
 */
export function calculateCatalogFingerprint(records) {
  const hasher = createCatalogFingerprintHasher()
  for (const record of records) {
    hasher.updateRecord(record)
  }
  return hasher.digest()
}
