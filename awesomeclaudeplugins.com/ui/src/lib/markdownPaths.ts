import { existsSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'

const PROXY_SQLITE_KEY = Symbol.for('awesome-claude-plugins.proxy-sqlite')

type ProxySqliteState = {
  db: InstanceType<typeof Database>
  isMarkdownStmt: ReturnType<InstanceType<typeof Database>['prepare']>
  cachedRepoPages?: readonly string[]
}

type ProxySqliteHolder = typeof globalThis & {
  [PROXY_SQLITE_KEY]?: ProxySqliteState
}

function getProxySqlite(): ProxySqliteState {
  const root = globalThis as ProxySqliteHolder
  if (root[PROXY_SQLITE_KEY]) return root[PROXY_SQLITE_KEY]

  const dbPath = process.env.CATALOG_SQLITE_PATH || join(process.cwd(), 'src/data/catalog.sqlite')
  if (!existsSync(dbPath)) {
    throw new Error(`Database file does not exist: ${dbPath}`)
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    db.pragma('cache_size = -2000')
    db.pragma('mmap_size = 0')
  } catch {}

  const isMarkdownStmt = db.prepare(`
    SELECT 1 FROM repositories
    WHERE canonical_key = ? AND is_canonical = 1 AND is_markdown_repo = 1
    LIMIT 1
  `)

  const holder = { db, isMarkdownStmt }
  root[PROXY_SQLITE_KEY] = holder
  return holder
}

export function getRepoPagesEndingInMd(): readonly string[] {
  const holder = getProxySqlite()
  if (holder.cachedRepoPages) return holder.cachedRepoPages
  const rows = holder.db
    .prepare("SELECT owner || '/' || repo_name AS path FROM markdown_repositories ORDER BY source_order")
    .all() as Array<{ path: string }>
  const pages = Object.freeze(rows.map((r) => r.path))
  holder.cachedRepoPages = pages
  return pages
}

export const REPO_PAGES_ENDING_IN_MD: readonly string[] = new Proxy([] as readonly string[], {
  get(_target, prop, receiver) {
    const list = getRepoPagesEndingInMd()
    const value = Reflect.get(list, prop, receiver)
    return typeof value === 'function' ? value.bind(list) : value
  },
})

/** Whether a path ending in `.md` is a repository page rather than a markdown representation. */
export function isRepoPageEndingInMd(repoPath: string): boolean {
  const { isMarkdownStmt } = getProxySqlite()
  return isMarkdownStmt.get(repoPath.toLowerCase()) !== undefined
}
