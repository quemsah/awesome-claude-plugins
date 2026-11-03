import { randomUUID } from 'node:crypto'
import { buildPublicCatalog, type CatalogRecord, type SnapshotInput, type SnapshotManifest } from '@awesome-claude-plugins/catalog-snapshot'
import type Database from 'better-sqlite3'
import { listPublishable } from '../storage/repositories.js'
import { formatPublicCatalogRecord } from './catalogSnapshot.js'
import { assertValidStatsDraft, type StatsRecord } from './statsDraft.js'

export type { CatalogRecord }
export { formatPublicCatalogRecord }

export interface BuildPublicCatalogOptions {
  outputPath: string
  snapshotId?: string
  draftStats?: StatsRecord
  provenance?: Record<string, unknown>
  createdAt?: string
}

export function getHistoricalStats(db: Database.Database): StatsRecord[] {
  return db.prepare('SELECT id, date, size FROM stats ORDER BY id').all() as StatsRecord[]
}

export function buildPublicCatalogFromCrawler(db: Database.Database, options: BuildPublicCatalogOptions): SnapshotManifest {
  const publishable = listPublishable(db)
  const records = publishable.map((r) => formatPublicCatalogRecord(r))

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
