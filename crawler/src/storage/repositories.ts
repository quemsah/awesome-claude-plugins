import type Database from 'better-sqlite3'

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

export function upsertDiscovery(db: Database.Database, htmlUrl: string, description: string | null): number {
  if (!htmlUrl.trim()) throw new Error('Discovery URL must not be blank')

  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO repositories (html_url, description, createdAt, updatedAt)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(html_url) DO UPDATE SET
      description = excluded.description,
      updatedAt = excluded.updatedAt
    WHERE repositories.owner IS NULL OR repositories.repo_name IS NULL OR repositories.owner_url IS NULL
  `).run(htmlUrl, description, now, now)
  const row = db.prepare('SELECT id FROM repositories WHERE html_url = ?').get(htmlUrl) as { id: number }
  return row.id
}

export function updateEnriched(db: Database.Database, id: number, fields: EnrichmentFields): boolean {
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
    .run({ ...fields, id, updatedAt: new Date().toISOString() })
  return result.changes !== 0
}

export function deleteById(db: Database.Database, id: number): boolean {
  return db.prepare('DELETE FROM repositories WHERE id = ?').run(id).changes !== 0
}

export function listForEnrichment(db: Database.Database, cursor: number, limit: number): RepositoryRow[] {
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('cursor must be a nonnegative integer')
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('limit must be a positive integer')
  return db.prepare('SELECT * FROM repositories WHERE id > ? ORDER BY id LIMIT ?').all(cursor, limit) as RepositoryRow[]
}

function canonicalIdentity(row: PublishableRepository): boolean {
  const { html_url, owner, owner_url, repo_name } = row
  if (!owner || !repo_name || !owner_url || !html_url) return false
  if (owner === '.' || owner === '..' || repo_name === '.' || repo_name === '..') return false
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo_name)) return false
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
