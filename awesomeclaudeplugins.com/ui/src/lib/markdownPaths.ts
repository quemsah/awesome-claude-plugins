import { existsSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import markdownPathsData from '../data/markdown-paths.json' with { type: 'json' }

/**
 * Catalogued repositories whose name ends with the markdown extension, so their HTML page
 * (`/sstklen/yes.md`) is spelled exactly the way the proxy normally spells a repository's
 * markdown representation (`/{owner}/{repo}.md`).
 *
 * This namespace is only unambiguous while the catalog does not also contain the same path without
 * the suffix (for example both `a/b` and `a/b.md`). `markdownPaths.test.ts` enforces that
 * invariant and fails CI if such a collision appears; the proxy deliberately does not invent an
 * alternate HTML URL for an unsupported collision.
 *
 * Loaded from a generated sidecar rather than the full catalog because the proxy is its own bundle.
 * The crawler snapshot publisher regenerates that sidecar atomically with `repos.json`, so this
 * exception set stays in sync without paying the cost of importing and validating the full catalog
 * in every server process. `markdownPaths.test.ts` still verifies the generated data against the catalog.
 */
export const REPO_PAGES_ENDING_IN_MD: readonly string[] = markdownPathsData

const repoPagePaths = new Set(REPO_PAGES_ENDING_IN_MD.map((repoPath) => repoPath.toLowerCase()))

const PROXY_SQLITE_KEY = Symbol.for('awesome-claude-plugins.proxy-sqlite')

type ProxySqliteHolder = typeof globalThis & {
  [PROXY_SQLITE_KEY]?: {
    db: InstanceType<typeof Database>
    isMarkdownStmt: ReturnType<InstanceType<typeof Database>['prepare']>
  }
}

function getProxySqlite() {
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

/** Whether a path ending in `.md` is a repository page rather than a markdown representation. */
export function isRepoPageEndingInMd(repoPath: string): boolean {
  if (process.env.CATALOG_BACKEND === 'sqlite') {
    const { isMarkdownStmt } = getProxySqlite()
    return isMarkdownStmt.get(repoPath.toLowerCase()) !== undefined
  }
  return repoPagePaths.has(repoPath.toLowerCase())
}
