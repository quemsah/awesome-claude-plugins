import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readSync, renameSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import {
  CorruptedSnapshotError,
  InvalidSnapshotInputError,
  MarkdownPathCollisionError,
  SnapshotMismatchError,
} from './errors.js'
import {
  calculateCatalogFingerprint,
  createCatalogFingerprintHasher,
} from './fingerprint.js'

export const SCHEMA_VERSION = 1
export const GENERATOR_VERSION = '1.1.0'

function validateSnapshotInput(input, outputPath) {
  if (!input || typeof input !== 'object') {
    throw new InvalidSnapshotInputError('Invalid snapshot input: expected an object')
  }
  if (!input.records || typeof input.records[Symbol.iterator] !== 'function') {
    throw new InvalidSnapshotInputError('Invalid snapshot input: records must be an iterable')
  }
  if (!Array.isArray(input.stats) && typeof input.stats?.[Symbol.iterator] !== 'function') {
    throw new InvalidSnapshotInputError('Invalid snapshot input: stats must be an iterable or array')
  }
  if (typeof input.snapshotId !== 'string' || !input.snapshotId.trim()) {
    throw new InvalidSnapshotInputError('Invalid snapshot input: snapshotId is required')
  }
  if (typeof outputPath !== 'string' || !outputPath.trim()) {
    throw new InvalidSnapshotInputError('Invalid outputPath: must be a non-empty string')
  }
}

function statsMatchExistingSnapshot(existingDb, stats) {
  const rows = existingDb
    .prepare('SELECT id, date, size FROM statistics ORDER BY source_order')
    .all()

  if (rows.length !== stats.length) return false
  return stats.every((stat, index) => {
    const row = rows[index]
    return row.id === stat.id && row.date === stat.date && row.size === stat.size
  })
}

function hashFileSha256Sync(filePath) {
  const fd = openSync(filePath, 'r')
  try {
    const hash = createHash('sha256')
    const buffer = Buffer.alloc(64 * 1024)
    let bytesRead = 0
    while ((bytesRead = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead))
    }
    return hash.digest('hex')
  } finally {
    closeSync(fd)
  }
}

function tryReuseExistingSnapshot(outputPath, snapshotId, records, stats) {
  if (!existsSync(outputPath)) return null
  try {
    const existingDb = new Database(outputPath, { readonly: true, fileMustExist: true })
    try {
      const check = existingDb.pragma('quick_check')
      if (!Array.isArray(check) || check.length === 0 || check[0].quick_check !== 'ok') {
        return null
      }
      const meta = existingDb.prepare('SELECT * FROM catalog_metadata WHERE id = 1').get()
      if (!meta) return null

      if (meta.snapshot_id === snapshotId) {
        if (!Array.isArray(records) || !Array.isArray(stats)) {
          throw new SnapshotMismatchError(
            `A snapshot with ID "${snapshotId}" already exists at "${outputPath}", but non-array inputs cannot be verified for reuse without consuming`
          )
        }

        const currentFingerprint = calculateCatalogFingerprint(records)
        const currentStatsMatch = statsMatchExistingSnapshot(existingDb, stats)
        const schemaMatches = meta.schema_version === SCHEMA_VERSION
        const generatorMatches = meta.generator_version === GENERATOR_VERSION

        if (
          !schemaMatches ||
          !generatorMatches ||
          currentFingerprint !== meta.catalog_fingerprint ||
          !currentStatsMatch
        ) {
          throw new SnapshotMismatchError(
            `Snapshot immutability violation: A snapshot with ID "${snapshotId}" already exists at "${outputPath}" with different contents or schema`
          )
        }

        const artifactSha256 = hashFileSha256Sync(outputPath)
        return {
          schemaVersion: meta.schema_version,
          generatorVersion: meta.generator_version,
          snapshotId: meta.snapshot_id,
          catalogFingerprint: meta.catalog_fingerprint,
          artifactSha256,
          recordCount: meta.record_count,
          canonicalCount: meta.canonical_count,
          pluginsCount: meta.plugins_count,
          statsCount: meta.stats_count,
          outputPath,
          createdAt: meta.created_at,
          provenance: meta.provenance_json ? JSON.parse(meta.provenance_json) : undefined,
        }
      }
    } finally {
      existingDb.close()
    }
  } catch (error) {
    if (error instanceof SnapshotMismatchError) {
      throw error
    }
    // Existing database cannot be read, fall through to full build
  }
  return null
}

function initCatalogSchema(db) {
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = OFF')

  db.exec(`
    CREATE TABLE catalog_metadata (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      schema_version INTEGER NOT NULL,
      generator_version TEXT NOT NULL,
      snapshot_id TEXT NOT NULL,
      catalog_fingerprint TEXT NOT NULL,
      artifact_sha256 TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      record_count INTEGER NOT NULL,
      canonical_count INTEGER NOT NULL,
      plugins_count INTEGER NOT NULL,
      stats_count INTEGER NOT NULL,
      provenance_json TEXT DEFAULT NULL
    );

    CREATE TABLE repositories (
      row_id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_order INTEGER NOT NULL UNIQUE,
      id INTEGER NOT NULL,
      owner TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      canonical_key TEXT NOT NULL,
      is_canonical INTEGER NOT NULL CHECK (is_canonical IN (0, 1)),
      is_markdown_repo INTEGER NOT NULL CHECK (is_markdown_repo IN (0, 1)),
      stargazers_count INTEGER NOT NULL,
      forks_count INTEGER NOT NULL,
      subscribers_count INTEGER NOT NULL,
      plugins_count INTEGER DEFAULT NULL,
      plugin_signal REAL NOT NULL DEFAULT 0,
      pushed_at TEXT DEFAULT NULL,
      catalog_added_at TEXT DEFAULT NULL,
      catalog_updated_at TEXT DEFAULT NULL,
      license TEXT DEFAULT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      has_description INTEGER NOT NULL DEFAULT 0,
      description_quality INTEGER NOT NULL DEFAULT 0,
      manifest_kind TEXT DEFAULT NULL,
      pushed_at_unix INTEGER NOT NULL DEFAULT 0,
      catalog_added_at_unix INTEGER NOT NULL DEFAULT 0,
      rank_stars INTEGER DEFAULT NULL,
      rank_forks INTEGER DEFAULT NULL,
      rank_plugins INTEGER DEFAULT NULL,
      rank_updated INTEGER DEFAULT NULL,
      rank_created INTEGER DEFAULT NULL,
      record_json TEXT NOT NULL
    );

    CREATE TABLE statistics (
      id INTEGER NOT NULL,
      date TEXT NOT NULL,
      size INTEGER NOT NULL,
      source_order INTEGER NOT NULL UNIQUE
    );

    CREATE VIRTUAL TABLE repo_fts USING fts5(
      text,
      tokenize='unicode61 tokenchars ''+#''',
      prefix='1 2 3 4'
    );

    CREATE VIEW markdown_repositories AS
    SELECT row_id, source_order, owner, repo_name, canonical_key
    FROM repositories
    WHERE is_canonical = 1 AND is_markdown_repo = 1;

    CREATE VIEW indexable_repositories AS
    SELECT
      row_id,
      source_order,
      id,
      owner,
      repo_name,
      canonical_key,
      pushed_at,
      catalog_added_at,
      catalog_updated_at,
      stargazers_count,
      archived
    FROM repositories
    WHERE is_canonical = 1 AND plugins_count IS NOT NULL;
  `)
}

function parseUnixDate(d) {
  if (!d) return 0
  const ms = Date.parse(d)
  return Number.isFinite(ms) ? ms : 0
}

function extractFtsText(parsed, owner, repoName) {
  const textParts = [
    repoName,
    owner,
    parsed.description,
    parsed.plugin_name,
    parsed.plugin_description,
    ...(parsed.plugins ?? []).flatMap((p) => [p.name, p.description]),
    ...(parsed.plugin_summaries ?? []).flatMap((p) => [p.name, p.description]),
  ]
  return textParts.filter((v) => typeof v === 'string' && v.trim().length > 0).join(' ')
}

function getNullable(val) {
  if (val === undefined) return null
  return val
}

function getNum(val) {
  if (typeof val === 'number') return val
  return 0
}

function calcDescMetrics(description) {
  if (!description) return [0, 0]
  const len = description.trim().length
  if (len === 0) return [0, 0]
  return [1, len >= 40 ? 2 : 1]
}

function calcPluginMetrics(pluginsCount, stars) {
  if (typeof pluginsCount !== 'number') return [null, 0]
  return [pluginsCount, pluginsCount * Math.log10(stars + 10)]
}

function extractRepoRowParams(parsed, sourceOrder, isCanonical, canonicalKey, recordJson) {
  const stars = getNum(parsed.stargazers_count)
  const [pluginsCount, pluginSignal] = calcPluginMetrics(parsed.plugins_count, stars)
  const [hasDesc, descriptionQuality] = calcDescMetrics(parsed.description)
  const repoName = parsed.repo_name || ''
  const isArchived =
    parsed.archived == null
      ? (/^\[archived\]/i.test(parsed.description?.trim() ?? '') ? 1 : 0)
      : (parsed.archived ? 1 : 0)
  const isMarkdown = /\.md$/i.test(repoName) ? 1 : 0

  return [
    sourceOrder,
    parsed.id,
    parsed.owner || '',
    repoName,
    canonicalKey,
    isCanonical,
    isMarkdown,
    stars,
    getNum(parsed.forks_count),
    getNum(parsed.subscribers_count),
    pluginsCount,
    pluginSignal,
    getNullable(parsed.pushed_at),
    getNullable(parsed.catalog_added_at),
    getNullable(parsed.catalog_updated_at),
    getNullable(parsed.license),
    isArchived,
    hasDesc,
    descriptionQuality,
    getNullable(parsed.manifest_kind),
    parseUnixDate(parsed.pushed_at),
    parseUnixDate(parsed.catalog_added_at),
    recordJson,
  ]
}

function populateRepositories(db, records, hasher) {
  const insertRepo = db.prepare(`
    INSERT INTO repositories (
      source_order, id, owner, repo_name, canonical_key, is_canonical,
      is_markdown_repo, stargazers_count, forks_count, subscribers_count,
      plugins_count, plugin_signal, pushed_at, catalog_added_at,
      catalog_updated_at, license, archived, has_description,
      description_quality, manifest_kind, pushed_at_unix,
      catalog_added_at_unix, record_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertFts = db.prepare('INSERT INTO repo_fts (rowid, text) VALUES (?, ?)')

  const seenCanonicalKeys = new Set()
  let recordCount = 0
  let canonicalCount = 0
  let pluginsCountTotal = 0

  const runInsertions = db.transaction(() => {
    for (const record of records) {
      const sourceOrder = recordCount++
      const recordJson = typeof record === 'string' ? record : JSON.stringify(record)
      const parsed = typeof record === 'string' ? JSON.parse(record) : record

      hasher.updateRecord(recordJson)

      const owner = parsed.owner ?? ''
      const repoName = parsed.repo_name ?? ''
      const canonicalKey = `${owner}/${repoName}`.toLowerCase()

      let isCanonical = 0
      if (!seenCanonicalKeys.has(canonicalKey)) {
        if (canonicalKey.endsWith('.md')) {
          const baseKey = canonicalKey.slice(0, -3)
          if (seenCanonicalKeys.has(baseKey)) {
            throw new MarkdownPathCollisionError(
              `Markdown path collision detected: "${canonicalKey}" conflicts with canonical repository "${baseKey}"`
            )
          }
        } else {
          const mdKey = `${canonicalKey}.md`
          if (seenCanonicalKeys.has(mdKey)) {
            throw new MarkdownPathCollisionError(
              `Markdown path collision detected: "${canonicalKey}" conflicts with canonical repository "${mdKey}"`
            )
          }
        }
        seenCanonicalKeys.add(canonicalKey)
        isCanonical = 1
        canonicalCount++
        if (parsed.plugins_count) {
          pluginsCountTotal += parsed.plugins_count
        }
      }

      const params = extractRepoRowParams(parsed, sourceOrder, isCanonical, canonicalKey, recordJson)
      const info = insertRepo.run(...params)
      if (isCanonical) {
        insertFts.run(info.lastInsertRowid, extractFtsText(parsed, owner, repoName))
      }
    }
  })

  runInsertions()

  return { recordCount, canonicalCount, pluginsCountTotal }
}

function populateStatistics(db, stats) {
  const insertStat = db.prepare('INSERT INTO statistics (id, date, size, source_order) VALUES (?, ?, ?, ?)')
  let statsCount = 0
  const runInsertions = db.transaction(() => {
    for (const stat of stats) {
      insertStat.run(stat.id, stat.date, stat.size, statsCount++)
    }
  })
  runInsertions()
  return statsCount
}

function calculateDenseRanksAndIndexes(db) {
  db.exec(`
    CREATE TEMP TABLE calculated_ranks AS
    SELECT
      row_id,
      dense_rank() OVER (ORDER BY archived ASC, stargazers_count DESC, has_description DESC) AS r_stars,
      dense_rank() OVER (ORDER BY archived ASC, forks_count DESC) AS r_forks,
      dense_rank() OVER (ORDER BY archived ASC, plugin_signal DESC, (COALESCE(plugins_count, 0)) DESC) AS r_plugins,
      dense_rank() OVER (ORDER BY archived ASC, pushed_at_unix DESC, stargazers_count DESC) AS r_updated,
      dense_rank() OVER (ORDER BY archived ASC, catalog_added_at_unix DESC, stargazers_count DESC) AS r_created
    FROM repositories;

    CREATE UNIQUE INDEX idx_temp_ranks ON calculated_ranks(row_id);

    UPDATE repositories
    SET
      rank_stars = (SELECT r_stars FROM calculated_ranks WHERE calculated_ranks.row_id = repositories.row_id),
      rank_forks = (SELECT r_forks FROM calculated_ranks WHERE calculated_ranks.row_id = repositories.row_id),
      rank_plugins = (SELECT r_plugins FROM calculated_ranks WHERE calculated_ranks.row_id = repositories.row_id),
      rank_updated = (SELECT r_updated FROM calculated_ranks WHERE calculated_ranks.row_id = repositories.row_id),
      rank_created = (SELECT r_created FROM calculated_ranks WHERE calculated_ranks.row_id = repositories.row_id);

    DROP TABLE calculated_ranks;

    CREATE INDEX idx_repositories_canonical_key ON repositories(canonical_key);
    CREATE INDEX idx_repositories_id ON repositories(id);
    CREATE INDEX idx_repositories_canonical_browse_stars ON repositories(is_canonical, archived ASC, stargazers_count DESC, has_description DESC, source_order ASC);
    CREATE INDEX idx_repositories_canonical_browse_forks ON repositories(is_canonical, archived ASC, forks_count DESC, source_order ASC);
    CREATE INDEX idx_repositories_canonical_browse_plugins ON repositories(is_canonical, archived ASC, plugin_signal DESC, (COALESCE(plugins_count, 0)) DESC, source_order ASC);
    CREATE INDEX idx_repositories_canonical_browse_updated ON repositories(is_canonical, archived ASC, pushed_at_unix DESC, stargazers_count DESC, source_order ASC);
    CREATE INDEX idx_repositories_canonical_browse_created ON repositories(is_canonical, archived ASC, catalog_added_at_unix DESC, stargazers_count DESC, source_order ASC);

    CREATE INDEX idx_repositories_rank_stars ON repositories(is_canonical, rank_stars);
    CREATE INDEX idx_repositories_rank_forks ON repositories(is_canonical, rank_forks);
    CREATE INDEX idx_repositories_rank_plugins ON repositories(is_canonical, rank_plugins);
    CREATE INDEX idx_repositories_rank_updated ON repositories(is_canonical, rank_updated);
    CREATE INDEX idx_repositories_rank_created ON repositories(is_canonical, rank_created);

    CREATE INDEX idx_statistics_source_order ON statistics(source_order);
    CREATE INDEX idx_statistics_date ON statistics(date);
    INSERT INTO repo_fts(repo_fts) VALUES ('optimize');
  `)
}

function verifyAndCloseDatabase(db, stagingPath) {
  const integrityCheck = db.pragma('integrity_check')
  if (!Array.isArray(integrityCheck) || integrityCheck[0]?.integrity_check !== 'ok') {
    throw new CorruptedSnapshotError(`Database integrity check failed: ${JSON.stringify(integrityCheck)}`)
  }

  db.prepare("INSERT INTO repo_fts(repo_fts) VALUES('integrity-check')").run()
  db.pragma('wal_checkpoint(TRUNCATE)')
  db.pragma('journal_mode = DELETE')
  db.close()

  if (existsSync(`${stagingPath}-wal`) || existsSync(`${stagingPath}-shm`)) {
    throw new CorruptedSnapshotError('Staging database retained WAL or SHM sidecar files after closing')
  }
}

/**
 * Builds the public SQLite catalog snapshot.
 *
 * @param {import('./index.d.ts').SnapshotInput} input
 * @param {string} outputPath
 * @returns {import('./index.d.ts').SnapshotManifest}
 */
export function buildPublicCatalog(input, outputPath) {
  validateSnapshotInput(input, outputPath)

  const existingManifest = tryReuseExistingSnapshot(
    outputPath,
    input.snapshotId,
    input.records,
    input.stats
  )
  if (existingManifest) return existingManifest

  mkdirSync(dirname(outputPath), { recursive: true })
  const stagingPath = `${outputPath}.staging.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.sqlite`

  let db
  try {
    db = new Database(stagingPath)
    initCatalogSchema(db)

    const hasher = createCatalogFingerprintHasher()
    const { recordCount, canonicalCount, pluginsCountTotal } = populateRepositories(db, input.records, hasher)
    const statsCount = populateStatistics(db, input.stats)

    calculateDenseRanksAndIndexes(db)

    const catalogFingerprint = hasher.digest()
    const createdAt = input.createdAt ?? new Date().toISOString()
    const provenanceJson = input.provenance ? JSON.stringify(input.provenance) : null

    db.prepare(`
      INSERT INTO catalog_metadata (
        id, schema_version, generator_version, snapshot_id,
        catalog_fingerprint, created_at, record_count,
        canonical_count, plugins_count, stats_count, provenance_json
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      SCHEMA_VERSION,
      GENERATOR_VERSION,
      input.snapshotId,
      catalogFingerprint,
      createdAt,
      recordCount,
      canonicalCount,
      pluginsCountTotal,
      statsCount,
      provenanceJson
    )

    verifyAndCloseDatabase(db, stagingPath)
    db = null

    const artifactSha256 = hashFileSha256Sync(stagingPath)

    renameSync(stagingPath, outputPath)

    return {
      schemaVersion: SCHEMA_VERSION,
      generatorVersion: GENERATOR_VERSION,
      snapshotId: input.snapshotId,
      catalogFingerprint,
      artifactSha256,
      recordCount,
      canonicalCount,
      pluginsCount: pluginsCountTotal,
      statsCount,
      outputPath,
      createdAt,
      provenance: input.provenance ?? undefined,
    }
  } catch (error) {
    if (db) {
      try {
        db.close()
      } catch {}
    }
    try {
      rmSync(stagingPath, { force: true })
      rmSync(`${stagingPath}-wal`, { force: true })
      rmSync(`${stagingPath}-shm`, { force: true })
    } catch {}
    throw error
  }
}
