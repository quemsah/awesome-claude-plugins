/** biome-ignore-all lint/style/useNamingConvention: JSON fixture preserves published field names */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prepareCatalog, validateDownloadUrl, validateReleasePointer } from '../../scripts/prepare-catalog.mjs'

const MISSING_STATS_PATTERN = /Catalog statistics dataset not found/
const ARTIFACT_MISMATCH_PATTERN = /published SHA-256/

describe('prepareCatalog script', () => {
  const tempDir = join(process.cwd(), 'src/lib/__temp_test_prepare_catalog__')
  let originalSqlitePath: string | undefined
  let originalManifestPath: string | undefined

  beforeEach(() => {
    originalSqlitePath = process.env.CATALOG_SQLITE_PATH
    originalManifestPath = process.env.CATALOG_MANIFEST_PATH
    delete process.env.CATALOG_SQLITE_PATH
    delete process.env.CATALOG_MANIFEST_PATH
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    if (originalSqlitePath !== undefined) process.env.CATALOG_SQLITE_PATH = originalSqlitePath
    else delete process.env.CATALOG_SQLITE_PATH
    if (originalManifestPath !== undefined) process.env.CATALOG_MANIFEST_PATH = originalManifestPath
    else delete process.env.CATALOG_MANIFEST_PATH
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('fails if stats.json is missing rather than generating incomplete snapshot', async () => {
    writeFileSync(join(tempDir, 'repos.json'), JSON.stringify([]))
    // stats.json is deliberately omitted

    await expect(prepareCatalog({ dataDir: tempDir })).rejects.toThrow(MISSING_STATS_PATTERN)
  })
  const writeSample = () => {
    writeFileSync(
      join(tempDir, 'repos.json'),
      JSON.stringify([
        { id: 1, owner: 'example', repo_name: 'plugin', description: 'A searchable plugin', plugins_count: 1, stargazers_count: 5 },
      ])
    )
    writeFileSync(join(tempDir, 'stats.json'), JSON.stringify([{ id: 1, date: '2026-11-01', size: 1 }]))
  }

  it('changes the snapshot identity when statistics change', async () => {
    writeSample()
    const first = await prepareCatalog({ dataDir: tempDir })
    writeFileSync(
      join(tempDir, 'stats.json'),
      JSON.stringify([
        { id: 1, date: '2026-11-01', size: 1 },
        { id: 2, date: '2026-11-02', size: 1 },
      ])
    )
    const second = await prepareCatalog({ dataDir: tempDir })
    expect(second.snapshotId).not.toBe(first.snapshotId)
  })

  it('refuses a modified artifact when the external manifest SHA-256 disagrees', async () => {
    writeSample()
    const first = await prepareCatalog({ dataDir: tempDir })
    const db = new Database(join(tempDir, 'catalog.sqlite'))
    try {
      db.prepare('UPDATE repo_fts SET text = ? WHERE rowid = 1').run('different FTS text')
    } finally {
      db.close()
    }
    const manifest = JSON.parse(readFileSync(join(tempDir, 'catalog.manifest.json'), 'utf8'))
    expect(manifest.artifactSha256).toBe(first.artifactSha256)
    await expect(prepareCatalog({ dataDir: tempDir })).rejects.toThrow(ARTIFACT_MISMATCH_PATTERN)
  })

  it('validates existing sqlite against release pointer', async () => {
    writeSample()
    const first = await prepareCatalog({ dataDir: tempDir })
    const pointer = {
      schemaVersion: first.schemaVersion,
      generatorVersion: first.generatorVersion,
      snapshotId: first.snapshotId,
      catalogFingerprint: first.catalogFingerprint,
      artifactSha256: first.artifactSha256,
      recordCount: first.recordCount,
      canonicalCount: first.canonicalCount,
      pluginsCount: first.pluginsCount,
      statsCount: first.statsCount,
    }
    writeFileSync(join(tempDir, 'catalog-release.json'), JSON.stringify(pointer))
    // Remove repos.json so it only has catalog.sqlite and catalog-release.json
    rmSync(join(tempDir, 'repos.json'))
    rmSync(join(tempDir, 'stats.json'))

    const validated = await prepareCatalog({ dataDir: tempDir })
    expect(validated.artifactSha256).toBe(first.artifactSha256)
  })

  it('refreshes stale sqlite and manifest when pointer advances to a newer release', async () => {
    writeSample()
    await prepareCatalog({ dataDir: tempDir })

    const secondDir = join(tempDir, 'sub')
    mkdirSync(secondDir, { recursive: true })
    const secondRecord = {
      id: 2,
      owner: 'example',
      repo_name: 'second-plugin',
      description: 'Another plugin',
      plugins_count: 1,
      stargazers_count: 10,
    }
    writeFileSync(join(secondDir, 'repos.json'), JSON.stringify([secondRecord]))
    writeFileSync(join(secondDir, 'stats.json'), JSON.stringify([{ id: 1, date: '2026-03-01', size: 1 }]))
    const second = await prepareCatalog({ dataDir: secondDir })

    const pointer = {
      schemaVersion: second.schemaVersion,
      generatorVersion: second.generatorVersion,
      snapshotId: second.snapshotId,
      catalogFingerprint: second.catalogFingerprint,
      artifactSha256: second.artifactSha256,
      recordCount: second.recordCount,
      canonicalCount: second.canonicalCount,
      pluginsCount: second.pluginsCount,
      statsCount: second.statsCount,
      artifactUrl: pathToFileURL(join(secondDir, 'catalog.sqlite')).href,
    }
    writeFileSync(join(tempDir, 'catalog-release.json'), JSON.stringify(pointer))
    rmSync(join(tempDir, 'repos.json'))
    rmSync(join(tempDir, 'stats.json'))

    const refreshed = await prepareCatalog({ dataDir: tempDir })
    expect(refreshed.artifactSha256).toBe(second.artifactSha256)
    expect(refreshed.snapshotId).toBe(second.snapshotId)
  })

  it('refreshes stale local sqlite when pointer identifies release without artifactUrl using fallback', async () => {
    writeSample()
    await prepareCatalog({ dataDir: tempDir })

    const secondDir = join(tempDir, 'sub2')
    mkdirSync(secondDir, { recursive: true })
    const secondRecord = {
      id: 3,
      owner: 'example',
      repo_name: 'third-plugin',
      description: 'Third plugin',
      plugins_count: 1,
      stargazers_count: 15,
    }
    writeFileSync(join(secondDir, 'repos.json'), JSON.stringify([secondRecord]))
    writeFileSync(join(secondDir, 'stats.json'), JSON.stringify([{ id: 1, date: '2026-04-01', size: 1 }]))
    const second = await prepareCatalog({ dataDir: secondDir })

    const pointer = {
      schemaVersion: second.schemaVersion,
      generatorVersion: second.generatorVersion,
      snapshotId: second.snapshotId,
      catalogFingerprint: second.catalogFingerprint,
      artifactSha256: second.artifactSha256,
      recordCount: second.recordCount,
      canonicalCount: second.canonicalCount,
      pluginsCount: second.pluginsCount,
      statsCount: second.statsCount,
    }
    writeFileSync(join(tempDir, 'catalog-release.json'), JSON.stringify(pointer))
    rmSync(join(tempDir, 'repos.json'))
    rmSync(join(tempDir, 'stats.json'))

    const previousUrl = process.env.CATALOG_SQLITE_URL
    process.env.CATALOG_SQLITE_URL = pathToFileURL(join(secondDir, 'catalog.sqlite')).href
    try {
      const refreshed = await prepareCatalog({ dataDir: tempDir })
      expect(refreshed.artifactSha256).toBe(second.artifactSha256)
      expect(refreshed.snapshotId).toBe(second.snapshotId)
    } finally {
      if (previousUrl === undefined) {
        delete process.env.CATALOG_SQLITE_URL
      } else {
        process.env.CATALOG_SQLITE_URL = previousUrl
      }
    }
  })

  it('builds an isolated standalone SQLite fixture instead of using the release pointer', () => {
    const scriptPath = join(process.cwd(), 'scripts/prepare-catalog.mjs')
    const fixturePath = join(process.cwd(), 'tests/e2e/fixtures/standalone-repos.json')
    const outputPath = join(tempDir, 'standalone.sqlite')
    const manifestPath = join(tempDir, 'standalone.manifest.json')

    execFileSync('node', [scriptPath], {
      stdio: 'pipe',
      env: {
        ...process.env,
        STANDALONE_E2E: '1',
        CATALOG_DATA_PATH: fixturePath,
        CATALOG_SQLITE_PATH: outputPath,
        CATALOG_MANIFEST_PATH: manifestPath,
      },
    })

    expect(existsSync(manifestPath)).toBe(true)
    const db = new Database(outputPath, { readonly: true })
    try {
      const metadata = db.prepare('SELECT record_count FROM catalog_metadata WHERE id = 1').get() as { record_count: number }
      expect(metadata.record_count).toBe(2)
    } finally {
      db.close()
    }
  })

  it('supports --source and --output CLI arguments', () => {
    const cliSourceDir = join(tempDir, 'cli-source')
    const cliOutputDir = join(tempDir, 'cli-out')
    mkdirSync(cliSourceDir, { recursive: true })
    mkdirSync(cliOutputDir, { recursive: true })

    writeFileSync(
      join(cliSourceDir, 'repos.json'),
      JSON.stringify([
        { id: 42, owner: 'cli-test', repo_name: 'cli-plugin', description: 'CLI plugin', plugins_count: 1, stargazers_count: 10 },
      ])
    )
    writeFileSync(join(cliSourceDir, 'stats.json'), JSON.stringify([{ id: 1, date: '2026-11-01', size: 1 }]))

    const customSqlite = join(cliOutputDir, 'custom.sqlite')
    const scriptPath = join(process.cwd(), 'scripts/prepare-catalog.mjs')

    execFileSync('node', [scriptPath, '--source', cliSourceDir, '--output', customSqlite], {
      stdio: 'pipe',
      env: { ...process.env, NODE_ENV: 'test' },
    })

    expect(existsSync(customSqlite)).toBe(true)
    expect(existsSync(join(cliOutputDir, 'catalog.manifest.json'))).toBe(true)

    const db = new Database(customSqlite, { readonly: true })
    try {
      const meta = db.prepare('SELECT * FROM catalog_metadata WHERE id = 1').get() as { record_count: number }
      expect(meta.record_count).toBe(1)
    } finally {
      db.close()
    }
  })

  it('builds into custom CATALOG_SQLITE_PATH and CATALOG_MANIFEST_PATH in standard production mode', () => {
    const cliSourceDir = join(tempDir, 'prod-source')
    const cliOutputDir = join(tempDir, 'prod-out')
    mkdirSync(cliSourceDir, { recursive: true })
    mkdirSync(cliOutputDir, { recursive: true })

    writeFileSync(
      join(cliSourceDir, 'repos.json'),
      JSON.stringify([
        {
          id: 99,
          owner: 'prod-test',
          repo_name: 'prod-plugin',
          description: 'Production custom path plugin',
          plugins_count: 1,
          stargazers_count: 15,
        },
      ])
    )
    writeFileSync(join(cliSourceDir, 'stats.json'), JSON.stringify([{ id: 1, date: '2026-11-01', size: 1 }]))

    const customSqlite = join(cliOutputDir, 'runtime-custom.sqlite')
    const customManifest = join(cliOutputDir, 'runtime-custom.manifest.json')
    const scriptPath = join(process.cwd(), 'scripts/prepare-catalog.mjs')

    execFileSync('node', [scriptPath, '--source', cliSourceDir], {
      stdio: 'pipe',
      env: {
        ...process.env,
        CATALOG_SQLITE_PATH: customSqlite,
        CATALOG_MANIFEST_PATH: customManifest,
        STANDALONE_E2E: undefined,
      },
    })

    expect(existsSync(customSqlite)).toBe(true)
    expect(existsSync(customManifest)).toBe(true)

    const db = new Database(customSqlite, { readonly: true })
    try {
      const meta = db.prepare('SELECT record_count FROM catalog_metadata WHERE id = 1').get() as { record_count: number }
      expect(meta.record_count).toBe(1)
    } finally {
      db.close()
    }
  })

  describe('validateReleasePointer', () => {
    const validPointer = {
      schemaVersion: 1,
      generatorVersion: 'catalog-snapshot@1.0.0',
      snapshotId: 'snap-12345',
      catalogFingerprint: 'fingerprint-abc',
      artifactSha256: 'a'.repeat(64),
      recordCount: 10,
      canonicalCount: 8,
      pluginsCount: 12,
      statsCount: 5,
    }

    it('accepts a fully specified valid release pointer', () => {
      expect(validateReleasePointer(validPointer)).toEqual(validPointer)
    })

    it.each([
      ['snapshotId (empty)', { ...validPointer, snapshotId: '' }, 'missing or invalid snapshotId'],
      [
        'snapshotId (omitted)',
        (() => {
          const { snapshotId: _, ...p } = validPointer
          return p
        })(),
        'missing or invalid snapshotId',
      ],
      ['catalogFingerprint (blank)', { ...validPointer, catalogFingerprint: '   ' }, 'missing or invalid catalogFingerprint'],
      [
        'catalogFingerprint (omitted)',
        (() => {
          const { catalogFingerprint: _, ...p } = validPointer
          return p
        })(),
        'missing or invalid catalogFingerprint',
      ],
      ['artifactSha256 (non-hex)', { ...validPointer, artifactSha256: 'xyz' }, 'invalid artifactSha256'],
      ['artifactSha256 (short)', { ...validPointer, artifactSha256: 'a'.repeat(63) }, 'invalid artifactSha256'],
      [
        'artifactSha256 (omitted)',
        (() => {
          const { artifactSha256: _, ...p } = validPointer
          return p
        })(),
        'invalid artifactSha256',
      ],
      ['schemaVersion (unknown)', { ...validPointer, schemaVersion: 999 }, 'unsupported schemaVersion'],
      ['schemaVersion (fractional)', { ...validPointer, schemaVersion: 1.1 }, 'unsupported schemaVersion'],
      ['recordCount (negative)', { ...validPointer, recordCount: -1 }, 'missing or invalid recordCount'],
      ['recordCount (fractional)', { ...validPointer, recordCount: 1.5 }, 'missing or invalid recordCount'],
      ['recordCount (Infinity)', { ...validPointer, recordCount: Number.POSITIVE_INFINITY }, 'missing or invalid recordCount'],
      ['recordCount (NaN)', { ...validPointer, recordCount: Number.NaN }, 'missing or invalid recordCount'],
      [
        'recordCount (omitted)',
        (() => {
          const { recordCount: _, ...p } = validPointer
          return p
        })(),
        'missing or invalid recordCount',
      ],
      ['canonicalCount (negative)', { ...validPointer, canonicalCount: -1 }, 'missing or invalid canonicalCount'],
      ['canonicalCount (fractional)', { ...validPointer, canonicalCount: 2.2 }, 'missing or invalid canonicalCount'],
      [
        'canonicalCount (omitted)',
        (() => {
          const { canonicalCount: _, ...p } = validPointer
          return p
        })(),
        'missing or invalid canonicalCount',
      ],
      ['pluginsCount (negative)', { ...validPointer, pluginsCount: -1 }, 'missing or invalid pluginsCount'],
      ['pluginsCount (fractional)', { ...validPointer, pluginsCount: 3.14 }, 'missing or invalid pluginsCount'],
      [
        'pluginsCount (omitted)',
        (() => {
          const { pluginsCount: _, ...p } = validPointer
          return p
        })(),
        'missing or invalid pluginsCount',
      ],
      ['statsCount (negative)', { ...validPointer, statsCount: -1 }, 'missing or invalid statsCount'],
      ['statsCount (fractional)', { ...validPointer, statsCount: 0.5 }, 'missing or invalid statsCount'],
      [
        'statsCount (omitted)',
        (() => {
          const { statsCount: _, ...p } = validPointer
          return p
        })(),
        'missing or invalid statsCount',
      ],
    ])('rejects pointer missing or invalid %s', (_field, pointer, message) => {
      expect(() => validateReleasePointer(pointer)).toThrow(message)
    })

    it('rejects a pointer containing only artifactUrl when preparing catalog', async () => {
      writeFileSync(join(tempDir, 'catalog-release.json'), JSON.stringify({ artifactUrl: 'http://example.com/catalog.sqlite' }))
      await expect(prepareCatalog({ dataDir: tempDir })).rejects.toThrow('missing or invalid snapshotId')
    })
  })

  describe('validateDownloadUrl', () => {
    it('accepts official GitHub release asset URLs', () => {
      expect(validateDownloadUrl('https://github.com/quemsah/awesome-claude-plugins/releases/download/v1/catalog.sqlite').hostname).toBe(
        'github.com'
      )
      expect(validateDownloadUrl('https://objects.githubusercontent.com/github-production-release-asset/catalog.sqlite').hostname).toBe(
        'objects.githubusercontent.com'
      )
    })

    it('rejects insecure HTTP protocols', () => {
      expect(() => validateDownloadUrl('http://github.com/quemsah/catalog.sqlite')).toThrow('Insecure download protocol')
    })

    it('rejects unauthorized external hosts', () => {
      expect(() => validateDownloadUrl('https://malicious.evil.com/catalog.sqlite')).toThrow('Disallowed catalog download host')
    })

    it('accepts file:// URLs in test environment', () => {
      expect(validateDownloadUrl('file:///path/to/catalog.sqlite').protocol).toBe('file:')
    })

    it('honors custom allowed hosts from environment variable', () => {
      const prev = process.env.CATALOG_ALLOWED_HOSTS
      try {
        process.env.CATALOG_ALLOWED_HOSTS = 'custom.cdn.net, mirrors.acme.org'
        expect(validateDownloadUrl('https://custom.cdn.net/catalog.sqlite').hostname).toBe('custom.cdn.net')
        expect(validateDownloadUrl('https://mirrors.acme.org/catalog.sqlite').hostname).toBe('mirrors.acme.org')
      } finally {
        if (prev !== undefined) {
          process.env.CATALOG_ALLOWED_HOSTS = prev
        } else {
          delete process.env.CATALOG_ALLOWED_HOSTS
        }
      }
    })
  })

  describe('atomic artifact replacement safety', () => {
    it('preserves existing sqlite catalog and manifest untouched if downloaded replacement fails validation', async () => {
      writeSample()
      await prepareCatalog({ dataDir: tempDir })
      const originalSqliteContent = readFileSync(join(tempDir, 'catalog.sqlite'))
      const originalManifestContent = readFileSync(join(tempDir, 'catalog.manifest.json'), 'utf8')

      // Remove source json so prepareCatalog relies on sqlite + pointer
      rmSync(join(tempDir, 'repos.json'))
      rmSync(join(tempDir, 'stats.json'))

      // Create an invalid corrupt artifact in sub directory
      const subDir = join(tempDir, 'corrupt-sub')
      mkdirSync(subDir, { recursive: true })
      writeFileSync(join(subDir, 'catalog.sqlite'), 'not a valid sqlite file')

      // Pointer claims a valid sha but points to corrupted file
      const pointer = {
        schemaVersion: 1,
        generatorVersion: 1,
        snapshotId: 'fake-corrupt-snapshot',
        catalogFingerprint: 'fake-fingerprint',
        artifactSha256: 'a'.repeat(64),
        recordCount: 1,
        canonicalCount: 1,
        pluginsCount: 1,
        statsCount: 1,
        artifactUrl: pathToFileURL(join(subDir, 'catalog.sqlite')).href,
      }

      await expect(prepareCatalog({ dataDir: tempDir, pointer })).rejects.toThrow()

      // The original sqlite database and manifest MUST be completely unchanged
      expect(readFileSync(join(tempDir, 'catalog.sqlite'))).toEqual(originalSqliteContent)
      expect(readFileSync(join(tempDir, 'catalog.manifest.json'), 'utf8')).toBe(originalManifestContent)
    })
  })
})
