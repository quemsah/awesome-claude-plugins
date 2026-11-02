import type { CatalogRecord } from '@awesome-claude-plugins/catalog-contract'
import type {
  CatalogMetadata,
  CatalogPage,
  ExpectedSnapshot,
  PageOptions,
  PublicCatalogReader,
  SearchPage,
  SeoRecord,
  SitemapRecord,
  SortOption,
  StatRecord,
} from './index.d.ts'

export type {
  CatalogMetadata,
  CatalogPage,
  CatalogRecord,
  ExpectedSnapshot,
  PageOptions,
  PublicCatalogReader,
  SearchPage,
  SeoRecord,
  SitemapRecord,
  SortOption,
  StatRecord,
}
export {
  CatalogSnapshotError,
  IncompatibleSchemaError,
  CorruptedSnapshotError,
  SnapshotMismatchError,
} from './errors.js'

export const SUPPORTED_SCHEMA_VERSION: number

export function openPublicCatalog(path: string, expected?: ExpectedSnapshot): PublicCatalogReader
