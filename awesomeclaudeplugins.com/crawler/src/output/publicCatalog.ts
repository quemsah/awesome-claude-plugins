import { randomUUID } from 'node:crypto'
import { buildPublicCatalog, type CatalogRecord, type SnapshotInput, type SnapshotManifest } from '@awesome-claude-plugins/catalog-snapshot'
import type Database from 'better-sqlite3'
import { parsePluginSummariesJson } from '../github/pluginSummaries.js'
import { listPublishable, type PublishableRepository } from '../storage/repositories.js'
import { publicTimestamp } from './catalogSnapshot.js'
import { assertValidStatsDraft, type StatsRecord } from './statsDraft.js'

export type { CatalogRecord }

export interface BuildPublicCatalogOptions {
  outputPath: string
  snapshotId?: string
  draftStats?: StatsRecord
  provenance?: Record<string, unknown>
  createdAt?: string
}

function attachPlugins(record: CatalogRecord, pluginsJson: string | null | undefined): void {
  const plugins = parsePluginSummariesJson(pluginsJson ?? null)
  if (plugins !== null) {
    record.plugins = plugins
  }
}

function attachMetadata(record: CatalogRecord, row: PublishableRepository): void {
  if (row.manifest_kind === 'standalone-plugin') {
    record.manifest_kind = row.manifest_kind
  }
  if (row.catalog_updated_at !== undefined) {
    record.catalog_updated_at = row.catalog_updated_at
  }
  const pushed = publicTimestamp(row.pushed_at)
  if (pushed) record.pushed_at = pushed
  const added = publicTimestamp(row.catalog_added_at)
  if (added) record.catalog_added_at = added
  if (row.license) record.license = row.license
  if (row.archived !== null && row.archived !== undefined) {
    record.archived = row.archived === true || row.archived === 1
  }
}

export function formatPublicCatalogRecord(row: PublishableRepository): CatalogRecord {
  const record = {
    stargazers_count: row.stargazers_count ?? 0,
    forks_count: row.forks_count ?? 0,
    subscribers_count: row.subscribers_count ?? 0,
    description: row.description ?? null,
    owner: row.owner ?? '',
    repo_name: row.repo_name ?? '',
    plugins_count: row.plugins_count,
  } as CatalogRecord

  attachPlugins(record, row.plugins_json)
  attachMetadata(record, row)
  record.id = row.id

  return record
}

export function getHistoricalStats(db: Database.Database): StatsRecord[] {
  return db.prepare('SELECT id, date, size FROM stats ORDER BY id').all() as StatsRecord[]
}

export function buildPublicCatalogFromCrawler(db: Database.Database, options: BuildPublicCatalogOptions): SnapshotManifest {
  const publishable = listPublishable(db)
  const records = publishable.map(formatPublicCatalogRecord)

  const history = getHistoricalStats(db)
  if (options.draftStats) {
    const draft = options.draftStats
    assertValidStatsDraft(draft)
    if (history.some((record) => record.id >= draft.id)) {
      throw new Error('Stats draft already present or older than history')
    }
    if (history.some((record) => record.date === draft.date)) {
      throw new Error('Stats draft date already present in history')
    }
    history.push(draft)
  }

  const snapshotId = options.snapshotId ?? `crawl-${randomUUID()}`

  const input: SnapshotInput = {
    records,
    stats: history,
    snapshotId,
    provenance: options.provenance,
    createdAt: options.createdAt,
  }

  return buildPublicCatalog(input, options.outputPath)
}
