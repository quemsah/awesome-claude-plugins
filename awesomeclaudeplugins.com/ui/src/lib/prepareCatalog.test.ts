import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prepareCatalog } from '../../scripts/prepare-catalog.mjs'

const MISSING_STATS_PATTERN = /Catalog statistics dataset not found/

describe('prepareCatalog script', () => {
  const tempDir = join(process.cwd(), 'src/lib/__temp_test_prepare_catalog__')

  beforeEach(() => {
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('fails if stats.json is missing rather than generating incomplete snapshot', () => {
    writeFileSync(join(tempDir, 'repos.json'), JSON.stringify([]))
    // stats.json is deliberately omitted

    expect(() => prepareCatalog({ dataDir: tempDir })).toThrow(MISSING_STATS_PATTERN)
  })
})
