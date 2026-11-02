import { existsSync } from 'node:fs'
import Database from 'better-sqlite3'
import {
  CorruptedSnapshotError,
  IncompatibleSchemaError,
  SnapshotMismatchError,
} from './errors.js'

const WORD_OR_TOKEN_CHAR = /[\p{L}\p{N}\p{M}+#]/u
const LETTER_OR_NUMBER_CHAR = /[\p{L}\p{N}\p{M}]/u

function getSearchTerms(query) {
  if (typeof query !== 'string') return []
  const terms = []
  let current = ''
  let hasLetterOrNumber = false

  for (const ch of query) {
    if (WORD_OR_TOKEN_CHAR.test(ch)) {
      current += ch
      if (LETTER_OR_NUMBER_CHAR.test(ch)) {
        hasLetterOrNumber = true
      }
    } else if (current.length > 0) {
      if (hasLetterOrNumber) {
        terms.push(current)
      }
      current = ''
      hasLetterOrNumber = false
    }
  }

  if (current.length > 0 && hasLetterOrNumber) {
    terms.push(current)
  }

  return terms.length === 0 || (terms.length === 1 && [...terms[0]].length < 2) ? [] : terms
}

const MAX_PAGINATION_VALUE = 2 ** 31 - 1

function toInteger(value, fallback, min) {
  const number = Number(value ?? fallback)
  return Number.isFinite(number)
    ? Math.min(MAX_PAGINATION_VALUE, Math.max(min, Math.trunc(number)))
    : fallback
}

const sortSql = {
  'stars-desc': 'archived ASC, stargazers_count DESC, has_description DESC, source_order ASC',
  'forks-desc': 'archived ASC, forks_count DESC, source_order ASC',
  'plugins-desc': 'archived ASC, plugin_signal DESC, plugins_count DESC, source_order ASC',
  'updated-desc': 'archived ASC, pushed_at_unix DESC, stargazers_count DESC, source_order ASC',
  'created-desc': 'archived ASC, catalog_added_at_unix DESC, stargazers_count DESC, source_order ASC',
}

const rankColumns = {
  'stars-desc': 'rank_stars',
  'forks-desc': 'rank_forks',
  'plugins-desc': 'rank_plugins',
  'updated-desc': 'rank_updated',
  'created-desc': 'rank_created',
}

/**
 * Opens a public SQLite catalog snapshot for reading and search.
 *
 * @param {string} path
 * @param {import('./index.d.ts').ExpectedSnapshot} [expected]
 * @returns {import('./index.d.ts').PublicCatalogReader}
 */
export function openPublicCatalog(path, expected = {}) {
  if (!path || typeof path !== 'string' || !existsSync(path)) {
    throw new CorruptedSnapshotError(`Database file does not exist: ${path}`)
  }

  let db
  try {
    db = new Database(path, { readonly: true, fileMustExist: true })
  } catch (error) {
    throw new CorruptedSnapshotError(`Cannot open database at ${path}`, { cause: error })
  }

  let metadataRow
  try {
    metadataRow = db.prepare('SELECT * FROM catalog_metadata WHERE id = 1').get()
  } catch (error) {
    db.close()
    throw new IncompatibleSchemaError('Missing or corrupt catalog_metadata table', { cause: error })
  }

  if (!metadataRow) {
    db.close()
    throw new IncompatibleSchemaError('Catalog metadata record not found')
  }

  if (expected.schemaVersion !== undefined && metadataRow.schema_version !== expected.schemaVersion) {
    db.close()
    throw new IncompatibleSchemaError(
      `Catalog schema version mismatch: expected ${expected.schemaVersion}, found ${metadataRow.schema_version}`
    )
  }

  if (expected.snapshotId !== undefined && metadataRow.snapshot_id !== expected.snapshotId) {
    db.close()
    throw new SnapshotMismatchError(
      `Catalog snapshot ID mismatch: expected ${expected.snapshotId}, found ${metadataRow.snapshot_id}`
    )
  }

  if (
    expected.catalogFingerprint !== undefined &&
    metadataRow.catalog_fingerprint !== expected.catalogFingerprint
  ) {
    db.close()
    throw new SnapshotMismatchError(
      `Catalog fingerprint mismatch: expected ${expected.catalogFingerprint}, found ${metadataRow.catalog_fingerprint}`
    )
  }

  const metadata = {
    schema_version: metadataRow.schema_version,
    generator_version: metadataRow.generator_version,
    snapshot_id: metadataRow.snapshot_id,
    catalog_fingerprint: metadataRow.catalog_fingerprint,
    artifact_sha256: metadataRow.artifact_sha256 ?? undefined,
    created_at: metadataRow.created_at,
    record_count: metadataRow.record_count,
    canonical_count: metadataRow.canonical_count,
    plugins_count: metadataRow.plugins_count,
    stats_count: metadataRow.stats_count,
  }

  const lookupStmt = db.prepare(`
    SELECT record_json FROM repositories
    WHERE canonical_key = ? AND is_canonical = 1
    LIMIT 1
  `)

  const lookupBySourceOrderStmt = db.prepare(`
    SELECT record_json FROM repositories
    WHERE source_order = ?
    LIMIT 1
  `)

  const isMarkdownStmt = db.prepare(`
    SELECT 1 FROM repositories
    WHERE canonical_key = ? AND is_canonical = 1 AND is_markdown_repo = 1
    LIMIT 1
  `)

  const countCanonicalStmt = db.prepare('SELECT count(*) as count FROM repositories WHERE is_canonical = 1')
  const sumPluginsStmt = db.prepare('SELECT coalesce(sum(plugins_count), 0) as count FROM repositories WHERE is_canonical = 1')

  return {
    getRepoByPath(path) {
      if (!path || typeof path !== 'string') return undefined
      const row = lookupStmt.get(path.toLowerCase())
      return row ? JSON.parse(row.record_json) : undefined
    },

    getRecordBySourceOrder(sourceOrder) {
      if (typeof sourceOrder !== 'number' || sourceOrder < 0) return undefined
      const row = lookupBySourceOrderStmt.get(sourceOrder)
      return row ? JSON.parse(row.record_json) : undefined
    },

    *iteratePublishedRecords(batchSize = 1000) {
      let lastSourceOrder = -1
      const batchLimit = toInteger(batchSize, 1000, 1)
      const stmt = db.prepare(`
        SELECT record_json, source_order
        FROM repositories
        WHERE source_order > ?
        ORDER BY source_order ASC
        LIMIT ?
      `)

      while (true) {
        const batch = stmt.all(lastSourceOrder, batchLimit)
        if (batch.length === 0) break
        for (const row of batch) {
          lastSourceOrder = row.source_order
          yield JSON.parse(row.record_json)
        }
      }
    },

    getBrowsePage(options = {}) {
      const sort = options.sort && sortSql[options.sort] ? options.sort : 'stars-desc'
      const page = toInteger(options.page, 0, 0)
      const pageSize = toInteger(options.pageSize, 24, 1)
      const offset = page * pageSize

      const orderClause = sortSql[sort]
      const rows = db.prepare(`
        SELECT record_json FROM repositories
        WHERE is_canonical = 1
        ORDER BY ${orderClause}
        LIMIT ? OFFSET ?
      `).all(pageSize, offset)

      return {
        matches: rows.map((r) => JSON.parse(r.record_json)),
        total: metadata.canonical_count,
        pluginsCount: metadata.plugins_count,
      }
    },

    searchRepos(query, options = {}) {
      const sort = options.sort && rankColumns[options.sort] ? options.sort : 'stars-desc'
      const page = toInteger(options.page, 0, 0)
      const pageSize = toInteger(options.pageSize, 24, 1)
      const terms = getSearchTerms(query)

      if (terms.length === 0) {
        return { matches: [], total: 0, pluginsCount: 0 }
      }

      const expression = terms.map((term, i) => `"${term}"${i === terms.length - 1 ? '*' : ''}`).join(' AND ')
      const rankCol = rankColumns[sort]

      const totalsStmt = db.prepare(`
        SELECT count(*) AS total, coalesce(sum(plugins_count), 0) AS pluginsCount
        FROM repo_fts
        JOIN repositories ON repositories.row_id = repo_fts.rowid
        WHERE repo_fts MATCH ? AND repositories.is_canonical = 1
      `)

      const counts = totalsStmt.get(expression) ?? { total: 0, pluginsCount: 0 }
      const offset = page * pageSize

      let matches = []
      if (counts.total > offset) {
        const pageStmt = db.prepare(`
          WITH cutoff AS MATERIALIZED (
            SELECT ${rankCol} AS value FROM repo_fts
            JOIN repositories ON repositories.row_id = repo_fts.rowid
            WHERE repo_fts MATCH ? AND repositories.is_canonical = 1
            ORDER BY ${rankCol} LIMIT 1 OFFSET ?
          )
          SELECT repositories.record_json, bm25(repo_fts) AS score
          FROM repo_fts
          JOIN repositories ON repositories.row_id = repo_fts.rowid
          WHERE repo_fts MATCH ? AND repositories.is_canonical = 1
            AND ${rankCol} <= (SELECT value FROM cutoff)
          ORDER BY ${rankCol}, score, repositories.source_order LIMIT ? OFFSET ?
        `)

        const rows = pageStmt.all(
          expression,
          Math.min(offset + pageSize, counts.total) - 1,
          expression,
          pageSize,
          offset
        )

        matches = rows.map((row) => ({
          item: JSON.parse(row.record_json),
          score: row.score,
        }))
      }

      return {
        matches,
        total: counts.total,
        pluginsCount: counts.pluginsCount,
      }
    },

    *iterateIndexableRepos(batchSize = 1000) {
      let lastSourceOrder = -1
      const batchLimit = toInteger(batchSize, 1000, 1)
      const stmt = db.prepare(`
        SELECT owner, repo_name, canonical_key, pushed_at, catalog_added_at, catalog_updated_at, stargazers_count, source_order
        FROM repositories
        WHERE is_canonical = 1 AND source_order > ?
        ORDER BY source_order ASC
        LIMIT ?
      `)

      while (true) {
        const batch = stmt.all(lastSourceOrder, batchLimit)
        if (batch.length === 0) break
        for (const row of batch) {
          lastSourceOrder = row.source_order
          yield {
            owner: row.owner,
            repo_name: row.repo_name,
            path: `${row.owner}/${row.repo_name}`,
            pushed_at: row.pushed_at,
            catalog_added_at: row.catalog_added_at,
            catalog_updated_at: row.catalog_updated_at,
            stargazers_count: row.stargazers_count,
          }
        }
      }
    },

    *iterateStatistics(batchSize = 1000) {
      let lastOrder = -1
      const batchLimit = toInteger(batchSize, 1000, 1)
      const stmt = db.prepare(`
        SELECT id, date, size, source_order
        FROM statistics
        WHERE source_order > ?
        ORDER BY source_order ASC
        LIMIT ?
      `)

      while (true) {
        const batch = stmt.all(lastOrder, batchLimit)
        if (batch.length === 0) break
        for (const row of batch) {
          lastOrder = row.source_order
          yield {
            id: row.id,
            date: row.date,
            size: row.size,
          }
        }
      }
    },

    isLiteralMarkdownRepo(path) {
      if (!path || typeof path !== 'string') return false
      const row = isMarkdownStmt.get(path.toLowerCase())
      return Boolean(row)
    },

    getCatalogMetadata() {
      return { ...metadata }
    },

    close() {
      if (db) {
        db.close()
        db = null
      }
    },
  }
}
