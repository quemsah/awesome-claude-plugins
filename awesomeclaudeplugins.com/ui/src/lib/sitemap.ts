/** biome-ignore-all lint/style/useNamingConvention: external data */
import type { MetadataRoute } from 'next'
import type { CatalogRepo } from './catalog.ts'
import { getCatalogLastModified } from './catalog.ts'
import { sqliteGetSitemapEntryCount, sqliteGetSitemapShard, sqliteGetSitemapShardCount } from './sqliteCatalogStore.ts'

export const SITEMAP_SHARD_SIZE = 25_000

let cachedFallbackLastModified: Date | undefined
function getFallbackLastModified(): Date {
  if (!cachedFallbackLastModified) {
    cachedFallbackLastModified = getCatalogLastModified()
  }
  return cachedFallbackLastModified
}

export function getRepoSitemapLastModified(repo: Pick<CatalogRepo, 'catalog_updated_at'>): Date {
  return repo.catalog_updated_at ? new Date(repo.catalog_updated_at) : getFallbackLastModified()
}

export function buildSitemapEntries(): MetadataRoute.Sitemap {
  const shardCount = getSitemapShardCount()
  const all: MetadataRoute.Sitemap = []
  for (let id = 0; id < shardCount; id += 1) {
    all.push(...getSitemapShard(id))
  }
  return all
}

export function getSitemapShardCount(): number {
  return sqliteGetSitemapShardCount()
}

export function getSitemapEntryCount(): number {
  return sqliteGetSitemapEntryCount()
}

export function getSitemapShard(shardId: number): MetadataRoute.Sitemap {
  return sqliteGetSitemapShard(shardId)
}
