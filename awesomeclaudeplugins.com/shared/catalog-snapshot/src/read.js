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
// The public catalog API has always limited pageSize to 100.
const MAX_PAGE_SIZE = 100

function toInteger(value, fallback, min) {
  const number = Number(value ?? fallback)
  return Number.isFinite(number)
    ? Math.min(MAX_PAGINATION_VALUE, Math.max(min, Math.trunc(number)))
    : fallback
}

const sortSql = {
  'stars-desc': 'archived ASC, stargazers_count DESC, has_description DESC, source_order ASC',
  'forks-desc': 'archived ASC, forks_count DESC, source_order ASC',
  'plugins-desc': 'archived ASC, plugin_signal DESC, COALESCE(plugins_count, 0) DESC, source_order ASC',
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

export const SUPPORTED_SCHEMA_VERSION = 1

function toCardRecord(record) {
  const card = { ...record }
  delete card.plugins
  delete card.plugin_summaries
  delete card.plugin_name
  delete card.plugin_description
  return card
}

function formatFullRecord(record) {
  // Match catalog.ts:formatCatalogRepo for a full API page without mutating
  // the published record stored in SQLite.
  const clean = (candidate) => {
    const result = {}
    if (typeof candidate?.name === 'string' && candidate.name.trim()) {
      result.name = candidate.name.trim()
    }
    if (typeof candidate?.description === 'string' && candidate.description.trim()) {
      result.description = candidate.description.trim()
    }
    return Object.keys(result).length > 0 ? result : null
  }
  let summaries
  if (Array.isArray(record.plugins) && record.plugins.length > 0) {
    summaries = record.plugins.map(clean).filter(Boolean)
  }
  if (!summaries?.length && Array.isArray(record.plugin_summaries) && record.plugin_summaries.length > 0) {
    summaries = record.plugin_summaries.map(clean).filter(Boolean)
  }
  if (!summaries?.length && (typeof record.plugin_name === 'string' || typeof record.plugin_description === 'string')) {
    const standalone = clean({ name: record.plugin_name, description: record.plugin_description })
    summaries = standalone ? [standalone] : []
  }
  return summaries?.length ? { ...record, plugins: summaries } : record
}

function openDatabase(path) {
  try {
    const db = new Database(path, { readonly: true, fileMustExist: true })
    try {
      db.pragma('cache_size = -8000')
      db.pragma('mmap_size = 0')
    } catch {
      // Non-fatal if pragma is restricted
    }
    return db
  } catch (error) {
    throw new CorruptedSnapshotError(`Cannot open database at ${path}`, { cause: error })
  }
}

function readAndValidateMetadata(db, expected = {}) {
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

  if (metadataRow.schema_version !== SUPPORTED_SCHEMA_VERSION) {
    db.close()
    throw new IncompatibleSchemaError(
      `Unsupported catalog schema version: reader supports version ${SUPPORTED_SCHEMA_VERSION}, found ${metadataRow.schema_version}`
    )
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

  return metadataRow
}

function verifyRequiredTables(db) {
  try {
    const check = db.pragma('quick_check')
    if (!Array.isArray(check) || check[0]?.quick_check !== 'ok') {
      db.close()
      throw new CorruptedSnapshotError('Database quick_check integrity verification failed')
    }
    db.prepare('SELECT 1 FROM repositories LIMIT 1').get()
    db.prepare('SELECT 1 FROM statistics LIMIT 1').get()
    db.prepare('SELECT 1 FROM repo_fts LIMIT 1').get()
    db.prepare('SELECT 1 FROM markdown_repositories LIMIT 1').get()
    db.prepare('SELECT 1 FROM indexable_repositories LIMIT 1').get()
  } catch (error) {
    if (error instanceof CorruptedSnapshotError) throw error
    db.close()
    throw new IncompatibleSchemaError('Required catalog tables or views are missing or corrupt', { cause: error })
  }
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

  let db = openDatabase(path)
  const metadataRow = readAndValidateMetadata(db, expected)
  verifyRequiredTables(db)

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
    provenance: metadataRow.provenance_json ? JSON.parse(metadataRow.provenance_json) : undefined,
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

  const lookupByIdStmt = db.prepare(`
    SELECT record_json FROM repositories
    WHERE id = ? AND is_canonical = 1
    LIMIT 1
  `)

  const lookupByIdAndPathStmt = db.prepare(`
    SELECT record_json FROM repositories
    WHERE id = ? AND canonical_key = ? AND is_canonical = 1
    LIMIT 1
  `)

  const isMarkdownStmt = db.prepare(`
    SELECT 1 FROM repositories
    WHERE canonical_key = ? AND is_canonical = 1 AND is_markdown_repo = 1
    LIMIT 1
  `)

  const isCanonicalStmt = db.prepare(`
    SELECT 1 FROM repositories
    WHERE id = ? AND canonical_key = ? AND is_canonical = 1
    LIMIT 1
  `)

  const isCanonicalByIdStmt = db.prepare(`
    SELECT 1 FROM repositories
    WHERE id = ? AND is_canonical = 1
    LIMIT 1
  `)

  const countIndexableStmt = db.prepare(`
    SELECT count(*) as count FROM repositories
    WHERE is_canonical = 1 AND plugins_count IS NOT NULL
  `)

  const sitemapStmt = db.prepare(`
    SELECT owner, repo_name, catalog_updated_at
    FROM repositories
    WHERE is_canonical = 1 AND plugins_count IS NOT NULL
    ORDER BY stargazers_count DESC, has_description DESC, source_order ASC
    LIMIT ? OFFSET ?
  `)

  const allStatsStmt = db.prepare(`
    SELECT id, date, size
    FROM statistics
    ORDER BY source_order ASC
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

    getRecordById(id, canonicalPath) {
      if (typeof id !== 'number' || !Number.isSafeInteger(id)) return undefined
      if (canonicalPath && typeof canonicalPath === 'string') {
        const row = lookupByIdAndPathStmt.get(id, canonicalPath.toLowerCase())
        if (row) return JSON.parse(row.record_json)
      }
      const row = lookupByIdStmt.get(id)
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
      const pageSize = Math.min(MAX_PAGE_SIZE, toInteger(options.pageSize, 24, 1))
      const view = options.view ?? 'full'
      const offset = page * pageSize

      const orderClause = sortSql[sort]
      const rows = db.prepare(`
        SELECT record_json FROM repositories
        WHERE is_canonical = 1
        ORDER BY ${orderClause}
        LIMIT ? OFFSET ?
      `).all(pageSize, offset)

      let items = rows.map((r) => JSON.parse(r.record_json))
      if (view === 'cards') {
        items = items.map(toCardRecord)
      } else {
        items = items.map(formatFullRecord)
      }

      const total = metadata.canonical_count
      const hasMore = offset + items.length < total

      return {
        matches: items,
        rows: items,
        total,
        pluginsCount: metadata.plugins_count,
        hasMore,
      }
    },

    searchRepos(query, options = {}) {
      const sort = options.sort && rankColumns[options.sort] ? options.sort : 'stars-desc'
      const page = toInteger(options.page, 0, 0)
      const pageSize = Math.min(MAX_PAGE_SIZE, toInteger(options.pageSize, 24, 1))
      const view = options.view ?? 'full'
      const terms = getSearchTerms(query)

      if (terms.length === 0) {
        return { matches: [], rows: [], total: 0, pluginsCount: 0, hasMore: false }
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

        matches = rows.map((row) => {
          const item = JSON.parse(row.record_json)
          return {
            item: view === 'cards' ? toCardRecord(item) : formatFullRecord(item),
            score: row.score,
          }
        })
      }

      const hasMore = offset + matches.length < counts.total

      return {
        matches,
        rows: matches,
        total: counts.total,
        pluginsCount: counts.pluginsCount,
        hasMore,
      }
    },

    *iterateIndexableRepos(batchSize = 1000) {
      let lastSourceOrder = -1
      const batchLimit = toInteger(batchSize, 1000, 1)
      const stmt = db.prepare(`
        SELECT owner, repo_name, canonical_key, pushed_at, catalog_added_at, catalog_updated_at, stargazers_count, source_order
        FROM repositories
        WHERE is_canonical = 1
          AND plugins_count IS NOT NULL
          AND source_order > ?
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

    isCanonicalRepo(id, owner, repoName) {
      if (typeof id !== 'number') return false
      if (owner && repoName) {
        return Boolean(isCanonicalStmt.get(id, `${owner}/${repoName}`.toLowerCase()))
      }
      return Boolean(isCanonicalByIdStmt.get(id))
    },

    getIndexableCount() {
      return countIndexableStmt.get().count
    },

    getSitemapPage(limit, offset) {
      const pageLimit = Math.max(0, toInteger(limit, 25000, 0))
      const pageOffset = Math.max(0, toInteger(offset, 0, 0))
      const rows = sitemapStmt.all(pageLimit, pageOffset)
      return rows.map((r) => ({
        owner: r.owner,
        repo_name: r.repo_name,
        path: `${r.owner}/${r.repo_name}`,
        catalog_updated_at: r.catalog_updated_at,
      }))
    },

    getStatistics() {
      return allStatsStmt.all()
    },

    getCatalogMetadata() {
      return { ...metadata }
    },

    verifyIntegrity() {
      if (!db || !db.open) return false
      try {
        const check = db.pragma('quick_check')
        return Array.isArray(check) && check[0]?.quick_check === 'ok'
      } catch {
        return false
      }
    },

    isOpen() {
      return Boolean(db && db.open)
    },

    close() {
      if (db) {
        db.close()
        db = null
      }
    },
  }
}
