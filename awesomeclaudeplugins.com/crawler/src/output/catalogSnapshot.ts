import type { CatalogRecord } from '@awesome-claude-plugins/catalog-snapshot'
import type Database from 'better-sqlite3'
import { parsePluginSummariesJson } from '../github/pluginSummaries.js'
import type { PublishableRepository } from '../storage/repositories.js'
import { assertValidStatsDraft, type StatsRecord } from './statsDraft.js'

// Recovery hashes written before catalog timestamps must match the exact original
// repos.json bytes, including canonical URLs, field order, and compact formatting.
/** Convert real GitHub/first-seen dates into the strict public UTC representation. */
export function publicTimestamp(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  // Date.parse accepts date-only strings and normalizes impossible dates (e.g. February 30).
  // GitHub timestamps and first-seen dates must be full ISO-8601 instants.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) return undefined
  const [, year, month, day, hour, minute, second, zone] = match
  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  if (
    y < 1000 ||
    m < 1 ||
    m > 12 ||
    d < 1 ||
    d > new Date(Date.UTC(y, m, 0)).getUTCDate() ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))
  )
    return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined
}

function attachCatalogMetadata(record: Record<string, unknown>, row: PublishableRepository, includeNewMetadata: boolean): void {
  if (!includeNewMetadata) return

  const pushed = publicTimestamp(row.pushed_at)
  if (pushed) record.pushed_at = pushed

  const added = publicTimestamp(row.catalog_added_at)
  if (added) record.catalog_added_at = added

  if (row.license) record.license = row.license

  if (row.archived != null) {
    record.archived = row.archived === 1 || row.archived === true
  }
}

export function formatPublicCatalogRecord(
  row: PublishableRepository,
  options: { includeCatalogUpdatedAt?: boolean; includeNewCatalogMetadata?: boolean } = {},
): CatalogRecord {
  const plugins = parsePluginSummariesJson(row.plugins_json ?? null)

  const record: Record<string, unknown> = {
    stargazers_count: row.stargazers_count,
    forks_count: row.forks_count,
    subscribers_count: row.subscribers_count,
    description: row.description,
    owner: row.owner,
    repo_name: row.repo_name,
    plugins_count: row.plugins_count,
  }

  if (options.includeCatalogUpdatedAt !== false) {
    if (plugins !== null) record.plugins = plugins
    if (row.manifest_kind === 'standalone-plugin') record.manifest_kind = row.manifest_kind
    if (row.catalog_updated_at !== undefined) record.catalog_updated_at = row.catalog_updated_at
    attachCatalogMetadata(record, row, options.includeNewCatalogMetadata !== false)
  }
  record.id = row.id

  return record as CatalogRecord
}

export function renderRepos(
  rows: readonly PublishableRepository[],
  options: { includeCatalogUpdatedAt?: boolean; includeNewCatalogMetadata?: boolean; legacyUrls?: boolean } = {},
): string {
  if (options.legacyUrls === true) {
    const legacyRepositories = rows.map((row) => ({
      html_url: row.html_url,
      stargazers_count: row.stargazers_count,
      forks_count: row.forks_count,
      subscribers_count: row.subscribers_count,
      description: row.description,
      owner: row.owner,
      owner_url: row.owner_url,
      repo_name: row.repo_name,
      plugins_count: row.plugins_count,
      id: row.id,
    }))
    return `${JSON.stringify(legacyRepositories)}\n`
  }

  const repositories = rows.map((row) => JSON.stringify(formatPublicCatalogRecord(row, options)))
  return `[\n${repositories.join(',\n')}\n]\n`
}

export function renderMarkdownPaths(repositories: readonly PublishableRepository[]): string {
  const seen = new Set<string>()
  const paths: string[] = []

  for (const row of repositories) {
    if (!(row.owner && row.repo_name && /\.md$/i.test(row.repo_name))) continue
    const path = `${row.owner}/${row.repo_name}`
    const key = path.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    paths.push(path)
  }

  paths.sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' }))
  return `${JSON.stringify(paths)}\n`
}

export function renderStats(db: Database.Database, draft?: StatsRecord): string {
  const history = db.prepare('SELECT id, date, size FROM stats ORDER BY id').all() as StatsRecord[]
  if (draft) {
    assertValidStatsDraft(draft)
    if (history.some((record) => record.id >= draft.id)) throw new Error('Stats draft already present or older than history')
    if (history.some((record) => record.date === draft.date)) throw new Error('Stats draft date already present in history')
    history.push(draft)
  }
  return `${JSON.stringify(history)}\n`
}
