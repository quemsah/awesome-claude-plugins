import type Database from 'better-sqlite3'
import { isValidGitHubOwner, isValidGitHubRepositoryName } from '../github/identifiers.js'

export interface RepositoryRow {
  id: number
  html_url: string | null
  stargazers_count: number | null
  forks_count: number | null
  subscribers_count: number | null
  description: string | null
  owner: string | null
  owner_url: string | null
  repo_name: string | null
  repo_updated: string | null
  plugins_count: number | null
  createdAt: string
  updatedAt: string
}

export type EnrichmentFields = Pick<
  RepositoryRow,
  | 'stargazers_count'
  | 'forks_count'
  | 'subscribers_count'
  | 'description'
  | 'owner'
  | 'owner_url'
  | 'repo_name'
  | 'repo_updated'
  | 'plugins_count'
>

export type PublishableRepository = Pick<
  RepositoryRow,
  | 'id'
  | 'html_url'
  | 'stargazers_count'
  | 'forks_count'
  | 'subscribers_count'
  | 'description'
  | 'owner'
  | 'owner_url'
  | 'repo_name'
  | 'plugins_count'
>

export function upsertDiscovery(db: Database.Database, htmlUrl: string, description: string | null, at = new Date().toISOString()): number {
  if (!htmlUrl.trim()) throw new Error('Discovery URL must not be blank')

  const existing = db.prepare('SELECT id FROM repositories WHERE html_url = ? COLLATE NOCASE ORDER BY id LIMIT 1').get(htmlUrl) as
    | { id: number }
    | undefined
  if (existing) {
    db.prepare(`
      UPDATE repositories SET description = ?, updatedAt = ?
      WHERE id = ? AND (owner IS NULL OR repo_name IS NULL OR owner_url IS NULL)
    `).run(description, at, existing.id)
    return existing.id
  }

  const result = db
    .prepare('INSERT INTO repositories (html_url, description, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
    .run(htmlUrl, description, at, at)
  return Number(result.lastInsertRowid)
}

export function updateEnriched(db: Database.Database, id: number, fields: EnrichmentFields, at = new Date().toISOString()): boolean {
  for (const field of ['stargazers_count', 'forks_count', 'subscribers_count', 'plugins_count'] as const) {
    const count = fields[field]
    if (count !== null && (!Number.isSafeInteger(count) || count < 0)) {
      throw new Error(`${field} must be a nonnegative integer or null`)
    }
  }

  const result = db
    .prepare(`
    UPDATE repositories SET
      stargazers_count = @stargazers_count,
      forks_count = @forks_count,
      subscribers_count = @subscribers_count,
      description = @description,
      owner = @owner,
      owner_url = @owner_url,
      repo_name = @repo_name,
      repo_updated = @repo_updated,
      plugins_count = @plugins_count,
      updatedAt = @updatedAt
    WHERE id = @id
  `)
    .run({ ...fields, id, updatedAt: at })
  return result.changes !== 0
}

export function deleteById(db: Database.Database, id: number): boolean {
  return db.prepare('DELETE FROM repositories WHERE id = ?').run(id).changes !== 0
}

export type CanonicalRebindResult = {
  id: number
  removedId: number | null
}

export function rebindCanonicalUrl(
  db: Database.Database,
  id: number,
  htmlUrl: string,
  at = new Date().toISOString(),
): CanonicalRebindResult {
  if (!htmlUrl.trim()) throw new Error('Canonical URL must not be blank')

  return db.transaction(() => {
    const current = db.prepare('SELECT id FROM repositories WHERE id = ?').get(id) as { id: number } | undefined
    if (!current) throw new Error('Repository to rebind does not exist')

    const duplicate = db
      .prepare('SELECT id FROM repositories WHERE html_url = ? COLLATE NOCASE AND id != ? ORDER BY id LIMIT 1')
      .get(htmlUrl, id) as { id: number } | undefined
    const keepId = duplicate ? Math.min(id, duplicate.id) : id
    const removedId = duplicate ? Math.max(id, duplicate.id) : null

    if (removedId !== null) db.prepare('DELETE FROM repositories WHERE id = ?').run(removedId)
    db.prepare('UPDATE repositories SET html_url = ?, updatedAt = ? WHERE id = ?').run(htmlUrl, at, keepId)
    return { id: keepId, removedId }
  })()
}

export function deleteCanonicalRows(db: Database.Database, id: number, htmlUrl: string): number | null {
  return db.transaction(() => {
    const duplicate = db
      .prepare('SELECT id FROM repositories WHERE html_url = ? COLLATE NOCASE AND id != ? ORDER BY id LIMIT 1')
      .get(htmlUrl, id) as { id: number } | undefined
    deleteById(db, id)
    if (duplicate) deleteById(db, duplicate.id)
    return duplicate?.id ?? null
  })()
}

export function getRepositoryById(db: Database.Database, id: number): RepositoryRow | null {
  return (db.prepare('SELECT * FROM repositories WHERE id = ?').get(id) as RepositoryRow | undefined) ?? null
}

export function listForEnrichment(db: Database.Database, cursor: number, limit: number): RepositoryRow[] {
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('cursor must be a nonnegative integer')
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('limit must be a positive integer')
  return db.prepare('SELECT * FROM repositories WHERE id > ? ORDER BY id LIMIT ?').all(cursor, limit) as RepositoryRow[]
}

function canonicalIdentity(row: PublishableRepository): boolean {
  const { html_url, owner, owner_url, repo_name } = row
  if (!owner || !repo_name || !owner_url || !html_url) return false
  if (!isValidGitHubOwner(owner) || !isValidGitHubRepositoryName(repo_name)) return false
  return owner_url === `https://github.com/${owner}` && html_url === `${owner_url}/${repo_name}`
}

export function listPublishable(db: Database.Database): PublishableRepository[] {
  const rows = db
    .prepare(`
    SELECT id, html_url, stargazers_count, forks_count, subscribers_count,
           description, owner, owner_url, repo_name, plugins_count
    FROM repositories
    WHERE html_url IS NOT NULL AND owner IS NOT NULL AND repo_name IS NOT NULL AND owner_url IS NOT NULL
      AND stargazers_count IS NOT NULL AND forks_count IS NOT NULL
      AND subscribers_count IS NOT NULL
    ORDER BY id
  `)
    .all() as PublishableRepository[]

  return rows.filter(
    (row) =>
      canonicalIdentity(row) &&
      [row.stargazers_count, row.forks_count, row.subscribers_count].every(
        (count) => Number.isSafeInteger(count) && (count as number) >= 0,
      ) &&
      (row.plugins_count === null || (Number.isSafeInteger(row.plugins_count) && row.plugins_count >= 0)),
  )
}
