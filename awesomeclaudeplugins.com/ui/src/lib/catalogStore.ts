/** biome-ignore-all lint/style/useNamingConvention: catalog data uses snake_case fields */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Repo } from '../schemas/repo.schema.ts'
import { getSqliteReader } from './sqliteCatalogStore.ts'

const CATALOG_KEY = Symbol.for('awesome-claude-plugins.catalog')
type CatalogGlobal = typeof globalThis & {
  [CATALOG_KEY]?: readonly Repo[]
}

export function getCatalog(): readonly Repo[] {
  const root = globalThis as CatalogGlobal
  const cachedCatalog = root[CATALOG_KEY]
  if (cachedCatalog !== undefined) return cachedCatalog

  const fixturePath = process.env.CATALOG_DATA_PATH
  if (fixturePath && existsSync(fixturePath)) {
    const catalog = JSON.parse(readFileSync(fixturePath, 'utf8')) as Repo[]
    root[CATALOG_KEY] = catalog
    return catalog
  }

  throw new Error('Unbounded full catalog materialization is disabled. Use sqliteCatalogStore streaming/paged queries.')
}

function matchesIdentity(repo: Partial<Repo>, id: number, owner?: string | null, repoName?: string | null): boolean {
  return (
    repo.id === id &&
    (owner == null || repo.owner?.toLowerCase() === owner.toLowerCase()) &&
    (repoName == null || repo.repo_name?.toLowerCase() === repoName.toLowerCase())
  )
}

function getRepoDetailsFromSqlite(id: number, owner?: string | null, repoName?: string | null): Partial<Repo> | null {
  const sqlitePath = process.env.CATALOG_SQLITE_PATH || join(process.cwd(), 'src/data/catalog.sqlite')
  if (!existsSync(sqlitePath)) return null
  const reader = getSqliteReader()
  const canonicalPath = owner && repoName ? `${owner}/${repoName}` : undefined
  const record = reader.getRecordById(id, canonicalPath) ?? (canonicalPath ? reader.getRepoByPath(canonicalPath) : undefined)
  return record && matchesIdentity(record, id, owner, repoName) ? (record as Repo) : null
}

/** Detail lookup delegates directly to SQLite point query without legacy JSON shards. */
export function getRepoDetails(id: number, owner?: string | null, repoName?: string | null): Partial<Repo> | null {
  return getRepoDetailsFromSqlite(id, owner, repoName)
}

export function hydrateCatalogRepo<T extends Repo>(repo: T): T {
  return repo
}
