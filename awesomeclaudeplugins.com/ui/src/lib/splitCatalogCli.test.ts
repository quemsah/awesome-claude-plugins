/** biome-ignore-all lint/style/useNamingConvention: Catalog fields and environment variables use snake_case and uppercase names. */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const scriptPath = fileURLToPath(new URL('../../scripts/split-catalog.mjs', import.meta.url))

it('keeps production catalog artifacts untouched in standalone builds but generates them normally', () => {
  const root = mkdtempSync(join(tmpdir(), 'split-catalog-cli-'))
  const dataDir = join(root, 'src/data')
  const detailsDir = join(dataDir, 'repo-details')
  const indexPath = join(dataDir, 'search-index.json')
  const shardPath = join(detailsDir, '1.json')
  const canonicalPath = join(dataDir, 'repos.json')
  const repos = [{ id: 1, owner: 'acme', repo_name: 'capsule', plugins: [{ name: 'Nebula Review Tools' }] }]
  const canonical = JSON.stringify(repos)

  try {
    mkdirSync(detailsDir, { recursive: true })
    writeFileSync(canonicalPath, canonical)
    writeFileSync(indexPath, 'keep-index')
    writeFileSync(shardPath, 'keep-shard')

    execFileSync(process.execPath, [scriptPath], {
      cwd: root,
      env: { ...process.env, STANDALONE_E2E: '1' },
    })
    expect(readFileSync(indexPath, 'utf8')).toBe('keep-index')
    expect(readFileSync(shardPath, 'utf8')).toBe('keep-shard')

    execFileSync(process.execPath, [scriptPath], {
      cwd: root,
      env: { ...process.env, STANDALONE_E2E: '0' },
    })
    expect(JSON.parse(readFileSync(indexPath, 'utf8'))).toMatchObject({
      format: 'v1',
      rows: [expect.arrayContaining([1, 'acme', 'capsule'])],
    })
    expect(JSON.parse(readFileSync(shardPath, 'utf8'))).toEqual({ '1': repos[0] })
    expect(readFileSync(canonicalPath, 'utf8')).toBe(canonical)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
