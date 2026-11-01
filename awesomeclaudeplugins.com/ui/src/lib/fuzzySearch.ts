import Database from 'better-sqlite3'
import type { Repo } from '../schemas/repo.schema.ts'
import { isArchivedRepo } from './repoMetadata.ts'
import type { SortOption } from './sortOptions.ts'

// Mirror FTS5 tokenchars for identifiers such as C++, C++17, C#, F#, #devtools, and foo+bar.
// Other punctuation remains a separator and cannot turn a one-letter search into a broad prefix.
const queryTerms = /[+#]*[\p{L}\p{N}\p{M}]+(?:[+#]+[\p{L}\p{N}\p{M}]+|[+#]+)*/gu
const sortSql: Record<SortOption, string> = {
  'stars-desc': 'stars DESC, description DESC',
  'forks-desc': 'forks DESC',
  'plugins-desc': 'plugin_signal DESC, plugins DESC',
  'updated-desc': 'updated DESC, stars DESC',
  'created-desc': 'created DESC, stars DESC',
}

type SearchPage = { matches: { item: Repo; score: number }[]; total: number; pluginsCount: number }
type CatalogSearchIndex = { search: (query: string, sort?: SortOption, page?: number, pageSize?: number) => SearchPage }
const indexes = new WeakMap<readonly Repo[], CatalogSearchIndex>()

function dateValue(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : 0
  return Number.isFinite(parsed) ? parsed : 0
}

/** An immutable in-memory FTS5 index. No query scans the catalog or materializes all matches in JS. */
export function createCatalogSearchIndex(repos: readonly Repo[]): CatalogSearchIndex {
  const cached = indexes.get(repos)
  if (cached) return cached

  const db = new Database(':memory:')
  db.exec(`
    CREATE VIRTUAL TABLE search USING fts5(text, content='', tokenize='unicode61 tokenchars ''+#''', prefix='1 2 3 4');
    CREATE TABLE metadata (
      id INTEGER PRIMARY KEY, archived INTEGER, stars INTEGER, description INTEGER,
      forks INTEGER, plugins INTEGER, plugin_signal REAL, updated REAL, created REAL
    );
  `)
  const insertText = db.prepare('INSERT INTO search(rowid, text) VALUES (?, ?)')
  const insertMetadata = db.prepare('INSERT INTO metadata VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  db.transaction(() => {
    for (const [id, repo] of repos.entries()) {
      const text = [
        repo.repo_name,
        repo.owner,
        repo.description,
        repo.plugin_name,
        repo.plugin_description,
        ...(repo.plugins ?? []).flatMap((plugin) => [plugin.name, plugin.description]),
        ...(repo.plugin_summaries ?? []).flatMap((plugin) => [plugin.name, plugin.description]),
      ].join(' ')
      // Source IDs need not be unique in arbitrary catalog inputs.
      insertText.run(id, text)
      const stars = repo.stargazers_count ?? 0
      const plugins = repo.plugins_count ?? 0
      insertMetadata.run(
        id,
        Number(isArchivedRepo(repo)),
        stars,
        repo.description?.trim() ? 1 : 0,
        repo.forks_count ?? 0,
        plugins,
        plugins * Math.log10(stars + 10),
        dateValue(repo.pushed_at),
        dateValue(repo.catalog_added_at)
      )
    }
  })()
  db.exec("INSERT INTO search(search) VALUES ('optimize')")

  const sorts = Object.entries(sortSql).map(([sort, order], i) => ({ sort: sort as SortOption, order, column: `sort${i}` }))
  // Equal metric keys share a rank. Requests sort integers and score only the groups through the page boundary.
  db.exec(`
    CREATE TABLE ranks (id INTEGER PRIMARY KEY, plugins INTEGER, ${sorts.map(({ column }) => `${column} INTEGER`).join(', ')});
    INSERT INTO ranks SELECT id, plugins,
      ${sorts.map(({ order }) => `dense_rank() OVER (ORDER BY archived, ${order})`).join(', ')} FROM metadata;
    DROP TABLE metadata;
    ALTER TABLE ranks RENAME TO metadata;
  `)

  const totals = db.prepare<[string], { total: number; pluginsCount: number }>(`
    SELECT count(*) AS total, coalesce(sum(plugins), 0) AS pluginsCount
    FROM search JOIN metadata ON metadata.id = search.rowid WHERE search MATCH ?
  `)
  const pages = new Map<SortOption, Database.Statement<[string, number, string, number, number], { id: number; score: number }>>()
  for (const { sort, column } of sorts) {
    pages.set(
      sort,
      db.prepare(`
        WITH cutoff AS MATERIALIZED (
          SELECT ${column} AS value FROM search JOIN metadata ON metadata.id = search.rowid WHERE search MATCH ?
          ORDER BY ${column} LIMIT 1 OFFSET ?
        )
        SELECT search.rowid AS id, bm25(search) AS score
        FROM search JOIN metadata ON metadata.id = search.rowid WHERE search MATCH ?
          AND ${column} <= (SELECT value FROM cutoff)
        ORDER BY ${column}, score, metadata.id LIMIT ? OFFSET ?
      `)
    )
  }

  const index: CatalogSearchIndex = {
    search(query, sort = 'stars-desc', page = 0, pageSize = 24) {
      // Quote tokens so punctuation and FTS operators cannot become search syntax.
      // A lone letter plus ignored punctuation (e.g. "c?") must not search all c* words.
      const terms = query.match(queryTerms) ?? []
      if (terms.length === 0 || (terms.length === 1 && [...terms[0]].length < 2)) {
        return { matches: [], total: 0, pluginsCount: 0 }
      }
      const expression = terms.map((term, i) => `"${term}"${i === terms.length - 1 ? '*' : ''}`).join(' AND ')
      const counts = totals.get(expression) ?? { total: 0, pluginsCount: 0 }
      const offset = page * pageSize
      // Include the whole cutoff metric group so BM25 still resolves every tie at a page boundary.
      const rows =
        counts.total > offset
          ? (pages.get(sort)?.all(expression, Math.min(offset + pageSize, counts.total) - 1, expression, pageSize, offset) ?? [])
          : []
      return { ...counts, matches: rows.map((row) => ({ item: repos[row.id], score: row.score })) }
    },
  }
  indexes.set(repos, index)
  return index
}
