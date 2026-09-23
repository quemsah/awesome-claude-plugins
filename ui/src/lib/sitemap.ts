/** biome-ignore-all lint/style/useNamingConvention: external data */
import type { MetadataRoute } from 'next'
import { getBrowsePageCount, getCatalogLastModified, getIndexableCatalogRepos, getRepoCanonicalPath } from './catalog.ts'
import { BASE_URL } from './constants.ts'

export const SITEMAP_SHARD_SIZE = 25_000

const catalogLastModified = getCatalogLastModified()
const totalBrowsePages = getBrowsePageCount()
const sortedIndexableRepos = [...getIndexableCatalogRepos()].sort(
  (left, right) =>
    (right.stargazers_count ?? 0) - (left.stargazers_count ?? 0) ||
    Number(Boolean(right.description?.trim())) - Number(Boolean(left.description?.trim())),
)

const prefixEntries: MetadataRoute.Sitemap = [
  { url: `${BASE_URL}/`, lastModified: catalogLastModified },
  { url: `${BASE_URL}/stats`, lastModified: catalogLastModified },
  { url: `${BASE_URL}/about` },
  { url: `${BASE_URL}/privacy` },
  ...Array.from({ length: Math.max(totalBrowsePages - 1, 0) }, (_, index) => ({
    url: `${BASE_URL}/browse/${index + 2}`,
    lastModified: catalogLastModified,
  })),
]

function repoEntry(repo: (typeof sortedIndexableRepos)[number]): MetadataRoute.Sitemap[number] {
  return {
    url: `${BASE_URL}/${getRepoCanonicalPath(repo)}`,
    lastModified: catalogLastModified,
  }
}

export function buildSitemapEntries(): MetadataRoute.Sitemap {
  return [...prefixEntries, ...sortedIndexableRepos.map(repoEntry)]
}

export function getSitemapEntryCount(): number {
  return prefixEntries.length + sortedIndexableRepos.length
}

export function getSitemapShardCount(): number {
  return Math.max(1, Math.ceil(getSitemapEntryCount() / SITEMAP_SHARD_SIZE))
}

export function getSitemapShard(id: number): MetadataRoute.Sitemap {
  if (!Number.isSafeInteger(id) || id < 0 || id >= getSitemapShardCount()) return []

  const start = id * SITEMAP_SHARD_SIZE
  const end = Math.min(start + SITEMAP_SHARD_SIZE, getSitemapEntryCount())
  const entries: MetadataRoute.Sitemap = []

  if (start < prefixEntries.length) {
    entries.push(...prefixEntries.slice(start, Math.min(end, prefixEntries.length)))
  }

  const repoStart = Math.max(0, start - prefixEntries.length)
  const repoEnd = Math.max(0, end - prefixEntries.length)
  if (repoStart < repoEnd) {
    entries.push(...sortedIndexableRepos.slice(repoStart, repoEnd).map(repoEntry))
  }

  return entries
}
