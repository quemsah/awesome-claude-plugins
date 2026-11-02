import type { CatalogRecord } from '@awesome-claude-plugins/catalog-contract'

export type { CatalogRecord }

export type SortOption =
  | 'stars-desc'
  | 'forks-desc'
  | 'plugins-desc'
  | 'updated-desc'
  | 'created-desc'

export type PageOptions = {
  sort?: SortOption
  page?: number
  pageSize?: number
  view?: 'full' | 'cards'
}

export type StatRecord = {
  id: number
  date: string
  size: number
}

export type SeoRecord = {
  owner: string
  repo_name: string
  path: string
  pushed_at?: string | null
  catalog_added_at?: string | null
  catalog_updated_at?: string | null
  stargazers_count: number
}

export type CatalogPage = {
  matches: CatalogRecord[]
  rows: CatalogRecord[]
  total: number
  pluginsCount: number
  hasMore: boolean
}

export type SearchPage = {
  matches: Array<{ item: CatalogRecord; score: number }>
  rows: Array<{ item: CatalogRecord; score: number }>
  total: number
  pluginsCount: number
  hasMore: boolean
}

export type CatalogMetadata = {
  schema_version: number
  generator_version: string
  snapshot_id: string
  catalog_fingerprint: string
  artifact_sha256?: string
  created_at: string
  record_count: number
  canonical_count: number
  plugins_count: number
  stats_count: number
  provenance?: {
    commit?: string
    runId?: string
    source?: string
  }
}

export type SnapshotInput = {
  records: Iterable<CatalogRecord>
  stats: readonly StatRecord[]
  snapshotId: string
  createdAt?: string
  provenance?: {
    commit?: string
    runId?: string
    source?: string
  }
}

export type SnapshotManifest = {
  schemaVersion: number
  generatorVersion: string
  snapshotId: string
  catalogFingerprint: string
  artifactSha256: string
  recordCount: number
  canonicalCount: number
  pluginsCount: number
  statsCount: number
  outputPath: string
  createdAt: string
  provenance?: {
    commit?: string
    runId?: string
    source?: string
  }
}

export type ExpectedSnapshot = {
  schemaVersion?: number
  snapshotId?: string
  catalogFingerprint?: string
}

export interface SitemapRecord {
  owner: string
  repo_name: string
  path: string
  catalog_updated_at: string | null
}

export interface PublicCatalogReader {
  getRepoByPath(path: string): CatalogRecord | undefined
  getRecordById(id: number): CatalogRecord | undefined
  getRecordBySourceOrder(sourceOrder: number): CatalogRecord | undefined
  getBrowsePage(options?: PageOptions): CatalogPage
  searchRepos(query: string, options?: PageOptions): SearchPage
  iteratePublishedRecords(batchSize?: number): Iterable<CatalogRecord>
  iterateIndexableRepos(batchSize?: number): Iterable<SeoRecord>
  iterateStatistics(batchSize?: number): Iterable<StatRecord>
  isLiteralMarkdownRepo(path: string): boolean
  isCanonicalRepo(id: number, owner?: string, repoName?: string): boolean
  getIndexableCount(): number
  getSitemapPage(limit: number, offset: number): SitemapRecord[]
  getStatistics(): StatRecord[]
  getCatalogMetadata(): CatalogMetadata
  close(): void
}

export const SCHEMA_VERSION: number
export const GENERATOR_VERSION: string
export const SUPPORTED_SCHEMA_VERSION: number

export function buildPublicCatalog(input: SnapshotInput, outputPath: string): SnapshotManifest

export function openPublicCatalog(path: string, expected?: ExpectedSnapshot): PublicCatalogReader

export interface CatalogFingerprintHasher {
  updateRecord(recordOrJson: CatalogRecord | string): void
  digest(): string
}

export function createCatalogFingerprintHasher(): CatalogFingerprintHasher

export function calculateCatalogFingerprint(records: Iterable<CatalogRecord | string>): string

export class CatalogSnapshotError extends Error {}
export class IncompatibleSchemaError extends CatalogSnapshotError {}
export class CorruptedSnapshotError extends CatalogSnapshotError {}
export class SnapshotMismatchError extends CatalogSnapshotError {}
export class SnapshotBuildLockedError extends CatalogSnapshotError {}
export class InvalidSnapshotInputError extends CatalogSnapshotError {}
export class MarkdownPathCollisionError extends InvalidSnapshotInputError {}
