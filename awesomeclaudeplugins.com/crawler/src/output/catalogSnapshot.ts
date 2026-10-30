import type Database from 'better-sqlite3'
import { parsePluginSummariesJson } from '../github/pluginSummaries.js'
import type { PublishableRepository } from '../storage/repositories.js'
import { assertValidStatsDraft, type StatsRecord } from './statsDraft.js'

// Recovery hashes written before catalog timestamps must match the exact original
// repos.json bytes, including canonical URLs, field order, and compact formatting.
/** Convert real GitHub/first-seen dates into the strict public UTC representation. */
function publicTimestamp(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined
}

export function renderRepos(
  rows: readonly PublishableRepository[],
  options: { includeCatalogUpdatedAt?: boolean; legacyUrls?: boolean } = {},
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
      ...(options.includeCatalogUpdatedAt === false || !publicTimestamp(row.pushed_at) ? {} : { pushed_at: publicTimestamp(row.pushed_at) }),
      ...(options.includeCatalogUpdatedAt === false || !publicTimestamp(row.catalog_added_at) ? {} : { catalog_added_at: publicTimestamp(row.catalog_added_at) }),
      ...(options.includeCatalogUpdatedAt === false || !row.license ? {} : { license: row.license }),
      ...(options.includeCatalogUpdatedAt === false || row.archived == null ? {} : { archived: row.archived === true || row.archived === 1 }),
      id: row.id,
    }))
    return `${JSON.stringify(legacyRepositories)}\n`
  }

  const repositories = rows.map((row) => {
    const plugins = parsePluginSummariesJson(row.plugins_json ?? null)
    return JSON.stringify({
      stargazers_count: row.stargazers_count,
      forks_count: row.forks_count,
      subscribers_count: row.subscribers_count,
      description: row.description,
      owner: row.owner,
      repo_name: row.repo_name,
      plugins_count: row.plugins_count,
      ...(options.includeCatalogUpdatedAt === false || plugins === null ? {} : { plugins }),
      ...(options.includeCatalogUpdatedAt === false ? {} : { catalog_updated_at: row.catalog_updated_at }),
      id: row.id,
    })
  })
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
