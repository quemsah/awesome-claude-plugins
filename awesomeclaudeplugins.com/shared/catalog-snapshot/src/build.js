import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import {
  CorruptedSnapshotError,
  InvalidSnapshotInputError,
} from './errors.js'
import { createCatalogFingerprintHasher } from './fingerprint.js'

export const SCHEMA_VERSION = 1
export const GENERATOR_VERSION = '1.0.0'

/**
 * Builds the public SQLite catalog snapshot.
 *
 * @param {import('./index.d.ts').SnapshotInput} input
 * @param {string} outputPath
 * @returns {import('./index.d.ts').SnapshotManifest}
 */
export function buildPublicCatalog(input, outputPath) {
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

  mkdirSync(dirname(outputPath), { recursive: true })

  // Idempotency: if outputPath already exists and is a valid catalog with the same snapshotId, return its manifest
  if (existsSync(outputPath)) {
    try {
      const existingDb = new Database(outputPath, { readonly: true, fileMustExist: true })
      try {
        const meta = existingDb.prepare('SELECT * FROM catalog_metadata WHERE id = 1').get()
        if (meta && meta.snapshot_id === input.snapshotId && meta.schema_version === SCHEMA_VERSION) {
          const fileBytes = readFileSync(outputPath)
          const artifactSha256 = createHash('sha256').update(fileBytes).digest('hex')
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
          }
        }
      } finally {
        existingDb.close()
      }
    } catch {
      // Existing file could not be read as identical snapshot, proceed with rebuilding
    }
  }

  const stagingPath = `${outputPath}.staging.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.sqlite`

  let db
  try {
    db = new Database(stagingPath)
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = OFF')

    // Create tables
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
        stats_count INTEGER NOT NULL
      );

      CREATE TABLE repositories (
        row_id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_order INTEGER NOT NULL UNIQUE,
        id INTEGER NOT NULL,
        owner TEXT NOT NULL,
        repo_name TEXT NOT NULL,
        canonical_key TEXT NOT NULL,
        is_canonical INTEGER NOT NULL,
        is_markdown_repo INTEGER NOT NULL DEFAULT 0,
        stargazers_count INTEGER NOT NULL DEFAULT 0,
        forks_count INTEGER NOT NULL DEFAULT 0,
        subscribers_count INTEGER NOT NULL DEFAULT 0,
        plugins_count INTEGER DEFAULT NULL,
        plugin_signal REAL NOT NULL DEFAULT 0.0,
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
        rank_stars INTEGER NOT NULL DEFAULT 0,
        rank_forks INTEGER NOT NULL DEFAULT 0,
        rank_plugins INTEGER NOT NULL DEFAULT 0,
        rank_updated INTEGER NOT NULL DEFAULT 0,
        rank_created INTEGER NOT NULL DEFAULT 0,
        record_json TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE repo_fts USING fts5(
        text,
        content='',
        tokenize='unicode61 tokenchars ''+#''',
        prefix='1 2 3 4'
      );

      CREATE TABLE statistics (
        id INTEGER PRIMARY KEY,
        date TEXT NOT NULL,
        size INTEGER NOT NULL,
        source_order INTEGER NOT NULL
      );

      CREATE VIEW markdown_repositories AS
      SELECT
        row_id,
        owner,
        repo_name,
        canonical_key,
        pushed_at,
        catalog_updated_at
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
      WHERE is_canonical = 1;
    `)

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

    const hasher = createCatalogFingerprintHasher()
    const seenCanonicalKeys = new Set()
    let recordCount = 0
    let canonicalCount = 0
    let pluginsCountTotal = 0

    const populateRepos = db.transaction(() => {
      for (const record of input.records) {
        const sourceOrder = recordCount++
        const recordJson = typeof record === 'string' ? record : JSON.stringify(record)
        const parsed = typeof record === 'string' ? JSON.parse(record) : record

        hasher.updateRecord(recordJson)

        const owner = parsed.owner ?? ''
        const repoName = parsed.repo_name ?? ''
        const canonicalKey = `${owner}/${repoName}`.toLowerCase()

        let isCanonical = 0
        if (!seenCanonicalKeys.has(canonicalKey)) {
          seenCanonicalKeys.add(canonicalKey)
          isCanonical = 1
          canonicalCount++
          if (parsed.plugins_count) {
            pluginsCountTotal += parsed.plugins_count
          }
        }

        const isMarkdown = /\.md$/i.test(repoName) ? 1 : 0
        const stars = parsed.stargazers_count ?? 0
        const forks = parsed.forks_count ?? 0
        const subscribers = parsed.subscribers_count ?? 0
        const pluginsCount = parsed.plugins_count ?? null
        const pluginSignal = (pluginsCount ?? 0) * Math.log10(stars + 10)
        const pushedAt = parsed.pushed_at ?? null
        const catalogAddedAt = parsed.catalog_added_at ?? null
        const catalogUpdatedAt = parsed.catalog_updated_at ?? null
        const license = parsed.license ?? null
        const archived = parsed.archived === true || parsed.archived === 1 ? 1 : 0
        const hasDescription = parsed.description?.trim() ? 1 : 0
        const descLen = parsed.description?.trim()?.length ?? 0
        const descriptionQuality = descLen >= 40 ? 2 : descLen > 0 ? 1 : 0
        const manifestKind = parsed.manifest_kind ?? null

        const parseDate = (d) => {
          if (!d) return 0
          const ms = Date.parse(d)
          return Number.isFinite(ms) ? ms : 0
        }
        const pushedAtUnix = parseDate(pushedAt)
        const catalogAddedAtUnix = parseDate(catalogAddedAt)

        const info = insertRepo.run(
          sourceOrder,
          parsed.id,
          owner,
          repoName,
          canonicalKey,
          isCanonical,
          isMarkdown,
          stars,
          forks,
          subscribers,
          pluginsCount,
          pluginSignal,
          pushedAt,
          catalogAddedAt,
          catalogUpdatedAt,
          license,
          archived,
          hasDescription,
          descriptionQuality,
          manifestKind,
          pushedAtUnix,
          catalogAddedAtUnix,
          recordJson
        )

        const rowId = info.lastInsertRowid

        // FTS text indexing all published fields including plugin summaries beyond 30 items
        const textParts = [
          repoName,
          owner,
          parsed.description,
          parsed.plugin_name,
          parsed.plugin_description,
          ...(parsed.plugins ?? []).flatMap((p) => [p.name, p.description]),
          ...(parsed.plugin_summaries ?? []).flatMap((p) => [p.name, p.description]),
        ]
        const text = textParts.filter((v) => typeof v === 'string' && v.trim().length > 0).join(' ')
        insertFts.run(rowId, text)
      }
    })

    populateRepos()

    // Populate statistics
    const insertStat = db.prepare('INSERT INTO statistics (id, date, size, source_order) VALUES (?, ?, ?, ?)')
    let statsCount = 0
    const populateStats = db.transaction(() => {
      for (const stat of input.stats) {
        insertStat.run(stat.id, stat.date, stat.size, statsCount++)
      }
    })
    populateStats()

    // Calculate dense ranks for the 5 sort options:
    // Equal metric keys share a rank, matching fuzzySearch.ts dense_rank() OVER (ORDER BY archived, ...)
    db.exec(`
      CREATE TEMP TABLE calculated_ranks AS
      SELECT
        row_id,
        dense_rank() OVER (ORDER BY archived ASC, stargazers_count DESC, has_description DESC) AS r_stars,
        dense_rank() OVER (ORDER BY archived ASC, forks_count DESC) AS r_forks,
        dense_rank() OVER (ORDER BY archived ASC, plugin_signal DESC, plugins_count DESC) AS r_plugins,
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
    `)

    // Create indexes
    db.exec(`
      CREATE INDEX idx_repositories_canonical_key ON repositories(canonical_key);
      CREATE INDEX idx_repositories_id ON repositories(id);
      CREATE INDEX idx_repositories_canonical_browse_stars ON repositories(is_canonical, archived ASC, stargazers_count DESC, has_description DESC, source_order ASC);
      CREATE INDEX idx_repositories_canonical_browse_forks ON repositories(is_canonical, archived ASC, forks_count DESC, source_order ASC);
      CREATE INDEX idx_repositories_canonical_browse_plugins ON repositories(is_canonical, archived ASC, plugin_signal DESC, plugins_count DESC, source_order ASC);
      CREATE INDEX idx_repositories_canonical_browse_updated ON repositories(is_canonical, archived ASC, pushed_at_unix DESC, stargazers_count DESC, source_order ASC);
      CREATE INDEX idx_repositories_canonical_browse_created ON repositories(is_canonical, archived ASC, catalog_added_at_unix DESC, stargazers_count DESC, source_order ASC);

      CREATE INDEX idx_repositories_rank_stars ON repositories(is_canonical, rank_stars);
      CREATE INDEX idx_repositories_rank_forks ON repositories(is_canonical, rank_forks);
      CREATE INDEX idx_repositories_rank_plugins ON repositories(is_canonical, rank_plugins);
      CREATE INDEX idx_repositories_rank_updated ON repositories(is_canonical, rank_updated);
      CREATE INDEX idx_repositories_rank_created ON repositories(is_canonical, rank_created);

      CREATE INDEX idx_statistics_source_order ON statistics(source_order);
      CREATE INDEX idx_statistics_date ON statistics(date);
    `)

    // Optimize FTS5
    db.exec("INSERT INTO repo_fts(repo_fts) VALUES ('optimize')")

    // Insert catalog_metadata
    const catalogFingerprint = hasher.digest()
    const createdAt = input.createdAt ?? new Date().toISOString()

    db.prepare(`
      INSERT INTO catalog_metadata (
        id, schema_version, generator_version, snapshot_id,
        catalog_fingerprint, created_at, record_count,
        canonical_count, plugins_count, stats_count
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      SCHEMA_VERSION,
      GENERATOR_VERSION,
      input.snapshotId,
      catalogFingerprint,
      createdAt,
      recordCount,
      canonicalCount,
      pluginsCountTotal,
      statsCount
    )

    // Verify SQLite integrity and FTS5 integrity
    const integrityCheck = db.pragma('integrity_check')
    if (!Array.isArray(integrityCheck) || integrityCheck[0]?.integrity_check !== 'ok') {
      throw new CorruptedSnapshotError(`Database integrity check failed: ${JSON.stringify(integrityCheck)}`)
    }

    db.prepare("INSERT INTO repo_fts(repo_fts) VALUES('integrity-check')").run()

    // Switch journal mode to DELETE and checkpoint WAL to ensure single standalone file
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.pragma('journal_mode = DELETE')
    db.close()
    db = null

    // Ensure no -wal or -shm sidecars remain
    if (existsSync(`${stagingPath}-wal`) || existsSync(`${stagingPath}-shm`)) {
      throw new CorruptedSnapshotError('Staging database retained WAL or SHM sidecar files after closing')
    }

    // Calculate final artifact SHA-256
    const artifactBytes = readFileSync(stagingPath)
    const artifactSha256 = createHash('sha256').update(artifactBytes).digest('hex')

    // Atomically activate verified artifact
    if (existsSync(outputPath)) {
      rmSync(outputPath, { force: true })
    }
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
