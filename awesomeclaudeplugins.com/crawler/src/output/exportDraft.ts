import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type Database from 'better-sqlite3'
import { getArtifactPublication } from '../publish/artifactPublisher.js'
import { hasArtifactTable, readDraftSnapshot, resolveArtifactPaths } from '../publish/publishRun.js'
import { buildRepoDetailsShards, buildSearchIndex } from './splitCatalog.js'

export class DraftExportError extends Error {
  constructor(readonly category: 'export_invalid_destination' | 'export_destination_exists' | 'export_write_failed') {
    super(`Draft export failed: ${category}`)
    this.name = 'DraftExportError'
  }
}

function resolveExportTarget(directory: string): string {
  if (!directory || !isAbsolute(directory)) throw new DraftExportError('export_invalid_destination')
  let parent: string
  try {
    parent = realpathSync(dirname(directory))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new DraftExportError('export_invalid_destination')
    throw new DraftExportError('export_write_failed')
  }
  const target = resolve(parent, basename(directory))
  const ui = resolve(import.meta.dirname, '../../../ui')
  const insideUi = relative(ui, target)
  if (insideUi === '' || (insideUi !== '..' && !insideUi.startsWith(`..${sep}`) && !isAbsolute(insideUi))) {
    throw new DraftExportError('export_invalid_destination')
  }
  try {
    mkdirSync(target, { mode: 0o700 })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') throw new DraftExportError('export_destination_exists')
    throw new DraftExportError('export_write_failed')
  }
  return target
}

function writeLegacyDraftFiles(dataDir: string, files: ReturnType<typeof readDraftSnapshot>): void {
  if (!files.reposJson) return
  writeFileSync(resolve(dataDir, 'repos.json'), files.reposJson, { flag: 'wx', mode: 0o600 })
  if (files.statsJson) writeFileSync(resolve(dataDir, 'stats.json'), files.statsJson, { flag: 'wx', mode: 0o600 })
  if (files.markdownPathsJson) writeFileSync(resolve(dataDir, 'markdown-paths.json'), files.markdownPathsJson, { flag: 'wx', mode: 0o600 })

  const parsedRepos = JSON.parse(files.reposJson)
  const searchIndex = buildSearchIndex(parsedRepos, files.reposJson)
  writeFileSync(resolve(dataDir, 'search-index.json'), searchIndex, { flag: 'wx', mode: 0o600 })

  const detailsDir = resolve(dataDir, 'repo-details')
  mkdirSync(detailsDir, { recursive: true })
  const shards = buildRepoDetailsShards(parsedRepos)
  for (const [name, content] of Object.entries(shards)) {
    writeFileSync(resolve(detailsDir, name), content, { flag: 'wx', mode: 0o600 })
  }
}

function copyArtifactSnapshot(db: Database.Database, runId: string, dataDir: string): void {
  if (!hasArtifactTable(db)) return
  const publication = getArtifactPublication(db, runId)
  const paths = resolveArtifactPaths()
  const artifactPath = publication?.artifact_path ?? paths?.outputPath
  if (!artifactPath || !existsSync(artifactPath)) {
    throw new DraftExportError('export_write_failed')
  }
  if (publication?.artifact_sha256) {
    const actualSha = createHash('sha256').update(readFileSync(artifactPath)).digest('hex')
    if (actualSha !== publication.artifact_sha256) {
      throw new DraftExportError('export_write_failed')
    }
  }
  copyFileSync(artifactPath, resolve(dataDir, 'catalog.sqlite'))
}

export function exportDraftSnapshot(db: Database.Database, runId: string, directory: string): void {
  const files = readDraftSnapshot(db, runId)
  const target = resolveExportTarget(directory)
  try {
    const data = resolve(target, 'ui/src/data')
    mkdirSync(data, { recursive: true })
    writeFileSync(resolve(target, 'README.md'), files.readme, { flag: 'wx', mode: 0o600 })

    writeLegacyDraftFiles(data, files)

    if (files.catalogReleaseJson) {
      copyArtifactSnapshot(db, runId, data)
      writeFileSync(resolve(target, 'ui/catalog-release.json'), files.catalogReleaseJson, { flag: 'wx', mode: 0o600 })
    }
  } catch (error) {
    rmSync(target, { recursive: true })
    if (error instanceof DraftExportError) throw error
    throw new DraftExportError('export_write_failed')
  }
}
