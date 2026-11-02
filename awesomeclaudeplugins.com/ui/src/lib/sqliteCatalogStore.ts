import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openPublicCatalog, type PublicCatalogReader } from '@awesome-claude-plugins/catalog-snapshot/read'
import type { MetadataRoute } from 'next'
import { StatsArraySchema, type StatsItem } from '../schemas/stats.schema.ts'
import type { CatalogRepo, CatalogSearchOptions, CatalogSearchResult } from './catalog.ts'
import { formatCatalogRepo, getRepoCanonicalPath } from './catalog.ts'
import { getLatestValidStatsDate } from './catalogDates.ts'
import { CATALOG_PAGE_SIZE } from './catalogPagination.ts'
import { type CatalogQuality, getCatalogQuality } from './catalogQuality.ts'
import { BASE_URL } from './constants.ts'
import { normalizeSearchQuery } from './searchQuery.ts'
import type { SortOption } from './sortOptions.ts'

const SQLITE_READER_KEY = Symbol.for('awesome-claude-plugins.sqlite-catalog-reader')

type GlobalWithSqliteReader = typeof globalThis & {
  [SQLITE_READER_KEY]?: {
    dbPath: string
    reader: PublicCatalogReader
    cachedLastModified?: Date
    cachedSummary?: {
      repoCount: number
      pluginRepositoryCount: number
      pluginCount: number
      updatedAt: string | null
    }
  }
}

export function getSqliteDbPath(): string {
  return process.env.CATALOG_SQLITE_PATH || join(process.cwd(), 'src/data/catalog.sqlite')
}

export function getSqliteManifestPath(): string {
  return process.env.CATALOG_MANIFEST_PATH || join(process.cwd(), 'src/data/catalog.manifest.json')
}

export function getSqliteReader(): PublicCatalogReader {
  const root = globalThis as GlobalWithSqliteReader
  const dbPath = getSqliteDbPath()

  if (root[SQLITE_READER_KEY]?.dbPath === dbPath) {
    return root[SQLITE_READER_KEY].reader
  }

  if (root[SQLITE_READER_KEY]) {
    try {
      root[SQLITE_READER_KEY].reader.close()
    } catch {}
    delete root[SQLITE_READER_KEY]
  }

  if (!existsSync(dbPath)) {
    throw new Error(`Database file does not exist: ${dbPath}`)
  }

  let expected: { schemaVersion?: number; snapshotId?: string; catalogFingerprint?: string } = { schemaVersion: 1 }
  const manifestPath = getSqliteManifestPath()
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (
        !manifest ||
        typeof manifest !== 'object' ||
        Array.isArray(manifest) ||
        typeof manifest.snapshotId !== 'string' ||
        typeof manifest.catalogFingerprint !== 'string'
      ) {
        throw new Error(`Invalid manifest structure at ${manifestPath}`)
      }
      expected = {
        schemaVersion: 1,
        snapshotId: manifest.snapshotId,
        catalogFingerprint: manifest.catalogFingerprint,
      }
    } catch (error) {
      throw new Error(`Failed to parse SQLite catalog manifest: ${manifestPath}`, { cause: error })
    }
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error(`Production SQLite catalog manifest does not exist: ${manifestPath}`)
  }

  const reader = openPublicCatalog(dbPath, expected)
  root[SQLITE_READER_KEY] = {
    dbPath,
    reader,
  }
  return reader
}

export function sqliteCloseCatalog(): void {
  const root = globalThis as GlobalWithSqliteReader
  if (root[SQLITE_READER_KEY]) {
    try {
      root[SQLITE_READER_KEY].reader.close()
    } catch {}
    delete root[SQLITE_READER_KEY]
  }
}

export function sqliteSearchCatalogRepos(
  query: string,
  sortOption: SortOption,
  page: number = 0,
  pageSize: number = CATALOG_PAGE_SIZE,
  options?: CatalogSearchOptions
): CatalogSearchResult {
  const reader = getSqliteReader()
  const normalizedQuery = normalizeSearchQuery(query)
  const view = options?.summaries === 'omit' ? 'cards' : 'full'

  if (normalizedQuery) {
    const result = reader.searchRepos(normalizedQuery, {
      sort: sortOption,
      page,
      pageSize,
      view,
    })
    return {
      hasMore: result.hasMore,
      pluginsCount: result.pluginsCount,
      repos: result.matches.map((match) => match.item as CatalogRepo),
      total: result.total,
    }
  }

  const result = reader.getBrowsePage({
    sort: sortOption,
    page,
    pageSize,
    view,
  })
  return {
    hasMore: result.hasMore,
    pluginsCount: result.pluginsCount,
    repos: result.matches as CatalogRepo[],
    total: result.total,
  }
}

export function sqliteFindCatalogRepo(repoPath: string): CatalogRepo | undefined {
  const reader = getSqliteReader()
  const raw = reader.getRepoByPath(repoPath)
  if (!raw) return undefined
  return formatCatalogRepo(raw as CatalogRepo)
}

export function sqliteGetCatalogCanonicalCount(): number {
  return getSqliteReader().getCatalogMetadata().canonical_count
}

export function sqliteGetBrowsePageCount(): number {
  return Math.ceil(sqliteGetCatalogCanonicalCount() / CATALOG_PAGE_SIZE)
}

export function sqliteGetCatalogLastModified(): Date {
  const root = globalThis as GlobalWithSqliteReader
  const reader = getSqliteReader()
  const current = root[SQLITE_READER_KEY]
  if (current?.cachedLastModified) {
    return current.cachedLastModified
  }

  const stats = reader.getStatistics()
  const lastModified = getLatestValidStatsDate(stats)
  if (current) {
    current.cachedLastModified = lastModified
  }
  return lastModified
}

export function sqliteGetCatalogSummary(): {
  repoCount: number
  pluginRepositoryCount: number
  pluginCount: number
  updatedAt: string | null
} {
  const root = globalThis as GlobalWithSqliteReader
  const reader = getSqliteReader()
  const current = root[SQLITE_READER_KEY]
  if (current?.cachedSummary) {
    return current.cachedSummary
  }

  const meta = reader.getCatalogMetadata()
  const latestDate = sqliteGetCatalogLastModified().toISOString()
  const pluginRepositoryCount = reader.getIndexableCount()
  const summary = {
    repoCount: meta.canonical_count,
    pluginRepositoryCount,
    pluginCount: meta.plugins_count,
    updatedAt: latestDate,
  }

  if (root[SQLITE_READER_KEY]) {
    root[SQLITE_READER_KEY].cachedSummary = summary
  }
  return summary
}

export function sqliteGetStatsHistory(): StatsItem[] {
  const reader = getSqliteReader()
  const stats = reader.getStatistics()
  const sorted = [...stats].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  const parsed = StatsArraySchema.safeParse(sorted)
  return parsed.success ? parsed.data : []
}

const SITEMAP_SHARD_SIZE = 25_000

const prefixEntries: MetadataRoute.Sitemap = [
  { url: `${BASE_URL}/` },
  { url: `${BASE_URL}/stats` },
  { url: `${BASE_URL}/about` },
  { url: `${BASE_URL}/privacy` },
]

export function sqliteGetSitemapEntryCount(): number {
  const reader = getSqliteReader()
  return prefixEntries.length + reader.getIndexableCount()
}

export function sqliteGetSitemapShardCount(): number {
  return Math.max(1, Math.ceil(sqliteGetSitemapEntryCount() / SITEMAP_SHARD_SIZE))
}

export function sqliteGetSitemapShard(id: number): MetadataRoute.Sitemap {
  if (!Number.isSafeInteger(id) || id < 0 || id >= sqliteGetSitemapShardCount()) return []

  const catalogLastModified = sqliteGetCatalogLastModified()
  const totalEntries = sqliteGetSitemapEntryCount()
  const start = id * SITEMAP_SHARD_SIZE
  const end = Math.min(start + SITEMAP_SHARD_SIZE, totalEntries)
  const entries: MetadataRoute.Sitemap = []

  if (start < prefixEntries.length) {
    const slice = prefixEntries.slice(start, Math.min(end, prefixEntries.length))
    for (const item of slice) {
      entries.push({
        url: item.url,
        lastModified: item.url === `${BASE_URL}/` || item.url === `${BASE_URL}/stats` ? catalogLastModified : undefined,
      })
    }
  }

  const repoStart = Math.max(0, start - prefixEntries.length)
  const repoEnd = Math.max(0, end - prefixEntries.length)
  const limit = repoEnd - repoStart

  if (limit > 0) {
    const reader = getSqliteReader()
    const rows = reader.getSitemapPage(limit, repoStart)
    for (const row of rows) {
      entries.push({
        url: `${BASE_URL}/${getRepoCanonicalPath(row)}`,
        lastModified: row.catalog_updated_at ? new Date(row.catalog_updated_at) : catalogLastModified,
      })
    }
  }

  return entries
}

export function sqliteIsCanonicalRepo(repo: CatalogRepo): boolean {
  if (repo.id && repo.owner && repo.repo_name) {
    return getSqliteReader().isCanonicalRepo(repo.id, repo.owner, repo.repo_name)
  }
  return true
}

export function sqliteGetCatalogQualityForRepo(repo: CatalogRepo, fallbackDescription?: string | null): CatalogQuality {
  return getCatalogQuality(repo, sqliteIsCanonicalRepo(repo), fallbackDescription)
}

export function sqliteGetCatalogVersionHash(): string {
  return getSqliteReader().getCatalogMetadata().catalog_fingerprint
}
