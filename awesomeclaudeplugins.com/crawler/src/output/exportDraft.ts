import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type Database from 'better-sqlite3'
import { readDraftSnapshot } from '../publish/publishRun.js'
import { buildRepoDetailsShards, buildSearchIndex } from './splitCatalog.js'

export class DraftExportError extends Error {
  constructor(readonly category: 'export_invalid_destination' | 'export_destination_exists' | 'export_write_failed') {
    super(`Draft export failed: ${category}`)
    this.name = 'DraftExportError'
  }
}

export function exportDraftSnapshot(db: Database.Database, runId: string, directory: string): void {
  if (!directory || !isAbsolute(directory)) throw new DraftExportError('export_invalid_destination')
  const files = readDraftSnapshot(db, runId)
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
  try {
    const data = resolve(target, 'ui/src/data')
    mkdirSync(data, { recursive: true })
    writeFileSync(resolve(target, 'README.md'), files.readme, { flag: 'wx', mode: 0o600 })

    if (files.reposJson) {
      writeFileSync(resolve(data, 'repos.json'), files.reposJson, { flag: 'wx', mode: 0o600 })
      if (files.statsJson) writeFileSync(resolve(data, 'stats.json'), files.statsJson, { flag: 'wx', mode: 0o600 })
      if (files.markdownPathsJson) writeFileSync(resolve(data, 'markdown-paths.json'), files.markdownPathsJson, { flag: 'wx', mode: 0o600 })

      const parsedRepos = JSON.parse(files.reposJson)
      const searchIndex = buildSearchIndex(parsedRepos, files.reposJson)
      writeFileSync(resolve(data, 'search-index.json'), searchIndex, { flag: 'wx', mode: 0o600 })

      const detailsDir = resolve(data, 'repo-details')
      mkdirSync(detailsDir, { recursive: true })
      const shards = buildRepoDetailsShards(parsedRepos)
      for (const [name, content] of Object.entries(shards)) {
        writeFileSync(resolve(detailsDir, name), content, { flag: 'wx', mode: 0o600 })
      }
    }

    if (files.catalogReleaseJson) {
      writeFileSync(resolve(target, 'ui/catalog-release.json'), files.catalogReleaseJson, { flag: 'wx', mode: 0o600 })
    }
  } catch {
    rmSync(target, { recursive: true })
    throw new DraftExportError('export_write_failed')
  }
}
