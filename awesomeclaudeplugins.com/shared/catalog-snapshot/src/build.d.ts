import type { CatalogRecord } from '@awesome-claude-plugins/catalog-contract'
import type { SnapshotInput, SnapshotManifest, StatRecord } from './index.d.ts'

export type { CatalogRecord, SnapshotInput, SnapshotManifest, StatRecord }
export {
  CatalogSnapshotError,
  IncompatibleSchemaError,
  CorruptedSnapshotError,
  SnapshotMismatchError,
  InvalidSnapshotInputError,
  MarkdownPathCollisionError,
} from './errors.js'

export const SCHEMA_VERSION: number
export const GENERATOR_VERSION: string

export function buildPublicCatalog(input: SnapshotInput, outputPath: string): SnapshotManifest
