import type { CatalogRecord } from '@awesome-claude-plugins/catalog-contract'

export type { CatalogRecord }

export interface CatalogFingerprintHasher {
  updateRecord(recordOrJson: CatalogRecord | string): void
  digest(): string
}

export function createCatalogFingerprintHasher(): CatalogFingerprintHasher
export function calculateCatalogFingerprint(records: Iterable<CatalogRecord | string>): string
