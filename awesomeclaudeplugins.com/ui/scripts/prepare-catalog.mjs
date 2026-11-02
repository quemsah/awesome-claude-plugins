import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildPublicCatalog } from '@awesome-claude-plugins/catalog-snapshot/build'
import { calculateCatalogFingerprint } from '@awesome-claude-plugins/catalog-snapshot/fingerprint'

/**
 * Prepares the SQLite public catalog snapshot from existing dataset files.
 * Designed for future transition where SnapshotInput is provided directly from crawler.
 *
 * @param {object} [options]
 * @param {string} [options.dataDir] Directory containing dataset JSON files
 * @param {string} [options.outputPath] Path to output SQLite database
 * @param {string} [options.manifestPath] Path to output snapshot manifest
 * @param {string} [options.snapshotId] Explicit snapshot ID
 * @returns {import('@awesome-claude-plugins/catalog-snapshot').SnapshotManifest}
 */
export function prepareCatalog(options = {}) {
  const dataDir = options.dataDir ?? join(process.cwd(), 'src/data')
  const reposPath = join(dataDir, 'repos.json')
  const statsPath = join(dataDir, 'stats.json')
  const outputPath = options.outputPath ?? join(dataDir, 'catalog.sqlite')
  const manifestPath = options.manifestPath ?? join(dataDir, 'catalog.manifest.json')

  if (!existsSync(reposPath)) {
    throw new Error(`Catalog source dataset not found: ${reposPath}`)
  }
  if (!existsSync(statsPath)) {
    throw new Error(`Catalog statistics dataset not found: ${statsPath}`)
  }

  const startTime = Date.now()
  console.log(`[prepare-catalog] Reading source dataset from ${dataDir}...`)
  const repos = JSON.parse(readFileSync(reposPath, 'utf8'))
  const stats = JSON.parse(readFileSync(statsPath, 'utf8'))

  const snapshotId = options.snapshotId ?? process.env.CATALOG_SNAPSHOT_ID ?? `snapshot-${calculateCatalogFingerprint(repos).slice(0, 16)}`

  console.log(`[prepare-catalog] Building SQLite snapshot for ${repos.length} records and ${stats.length} stats entries...`)

  const manifest = buildPublicCatalog(
    {
      records: repos,
      stats,
      snapshotId,
      createdAt: new Date().toISOString(),
    },
    outputPath
  )

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
  console.log(`[prepare-catalog] Completed in ${elapsed}s:`)
  console.log(`  Output SQLite:        ${manifest.outputPath}`)
  console.log(`  Artifact SHA-256:     ${manifest.artifactSha256}`)
  console.log(`  Catalog Fingerprint:  ${manifest.catalogFingerprint}`)
  console.log(`  Total Records:        ${manifest.recordCount}`)
  console.log(`  Canonical Records:    ${manifest.canonicalCount}`)
  console.log(`  Total Plugins:        ${manifest.pluginsCount}`)
  console.log(`  Stats History Rows:   ${manifest.statsCount}`)

  return manifest
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  prepareCatalog()
}
