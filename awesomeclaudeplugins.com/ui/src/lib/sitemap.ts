/** biome-ignore-all lint/style/useNamingConvention: external data */
import type { MetadataRoute } from 'next'
import { type CatalogRepo, getCatalogBackend, getCatalogLastModified, getIndexableCatalogRepos, getRepoCanonicalPath } from './catalog.ts'
import { BASE_URL } from './constants.ts'
import { sqliteGetSitemapEntryCount, sqliteGetSitemapShard, sqliteGetSitemapShardCount } from './sqliteCatalogStore.ts'

export const SITEMAP_SHARD_SIZE = 25_000

const prefixEntries: MetadataRoute.Sitemap = [
  { url: `${BASE_URL}/` },
  { url: `${BASE_URL}/stats` },
  { url: `${BASE_URL}/about` },
  { url: `${BASE_URL}/privacy` },
]

function getPrefixEntries(): MetadataRoute.Sitemap {
  const catalogLastModified = getCatalogLastModified()
  return [
    { url: `${BASE_URL}/`, lastModified: catalogLastModified },
    { url: `${BASE_URL}/stats`, lastModified: catalogLastModified },
    { url: `${BASE_URL}/about` },
    { url: `${BASE_URL}/privacy` },
  ]
}

let cachedLegacySortedIndexableRepos: readonly CatalogRepo[] | null = null

function getLegacySortedIndexableRepos(): readonly CatalogRepo[] {
  if (cachedLegacySortedIndexableRepos) return cachedLegacySortedIndexableRepos

  cachedLegacySortedIndexableRepos = [...getIndexableCatalogRepos()].sort(
    (left, right) =>
      (right.stargazers_count ?? 0) - (left.stargazers_count ?? 0) ||
      Number(Boolean(right.description?.trim())) - Number(Boolean(left.description?.trim()))
  )
  return cachedLegacySortedIndexableRepos
}

export function getRepoSitemapLastModified(repo: Pick<CatalogRepo, 'catalog_updated_at'>): Date {
  return repo.catalog_updated_at ? new Date(repo.catalog_updated_at) : getCatalogLastModified()
}

function repoEntry(repo: CatalogRepo): MetadataRoute.Sitemap[number] {
  return {
    url: `${BASE_URL}/${getRepoCanonicalPath(repo)}`,
    lastModified: getRepoSitemapLastModified(repo),
  }
}

export function buildSitemapEntries(): MetadataRoute.Sitemap {
  if (getCatalogBackend() === 'sqlite') {
    const shardCount = getSitemapShardCount()
    const all: MetadataRoute.Sitemap = []
    for (let id = 0; id < shardCount; id += 1) {
      all.push(...getSitemapShard(id))
    }
    return all
  }
  const prefix = getPrefixEntries()
  const sorted = getLegacySortedIndexableRepos()
  return [...prefix, ...sorted.map(repoEntry)]
}

export function getSitemapEntryCount(): number {
  if (getCatalogBackend() === 'sqlite') {
    return sqliteGetSitemapEntryCount()
  }
  return prefixEntries.length + getLegacySortedIndexableRepos().length
}

export function getSitemapShardCount(): number {
  if (getCatalogBackend() === 'sqlite') {
    return sqliteGetSitemapShardCount()
  }
  return Math.max(1, Math.ceil(getSitemapEntryCount() / SITEMAP_SHARD_SIZE))
}

export function getSitemapShard(id: number): MetadataRoute.Sitemap {
  if (getCatalogBackend() === 'sqlite') {
    return sqliteGetSitemapShard(id)
  }

  if (!Number.isSafeInteger(id) || id < 0 || id >= getSitemapShardCount()) return []

  const totalEntries = getSitemapEntryCount()
  const start = id * SITEMAP_SHARD_SIZE
  const end = Math.min(start + SITEMAP_SHARD_SIZE, totalEntries)
  const entries: MetadataRoute.Sitemap = []
  const prefix = getPrefixEntries()

  if (start < prefix.length) {
    entries.push(...prefix.slice(start, Math.min(end, prefix.length)))
  }

  const sorted = getLegacySortedIndexableRepos()
  const repoStart = Math.max(0, start - prefix.length)
  const repoEnd = Math.max(0, end - prefix.length)
  if (repoStart < repoEnd) {
    entries.push(...sorted.slice(repoStart, repoEnd).map(repoEntry))
  }

  return entries
}
