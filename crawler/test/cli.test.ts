import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatCliError, runCli } from '../src/cli.js'
import type { GitHubReader } from '../src/github/client.js'
import type { GitHubGit } from '../src/publish/githubGit.js'
import { PublicationError, prepareDraft } from '../src/publish/publishRun.js'
import { openDatabase } from '../src/storage/db.js'
import {
  beginRun,
  claimPublicationLease,
  completeRun,
  failRun,
  getRun,
  getSetting,
  listRunErrors,
  setSetting,
} from '../src/storage/runs.js'

const scratch: string[] = []
const fixtures = join(import.meta.dirname, 'fixtures')

function cli(args: string[], dbPath: string) {
  return spawnSync(process.execPath, [join(import.meta.dirname, '../dist/cli.js'), ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DB_PATH: dbPath,
      GITHUB_READ_TOKEN: 'fake-read-token',
      PUBLISH_ENABLED: 'false',
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_CHAT_ID: '',
    },
  })
}

function databasePath() {
  const dir = mkdtempSync(join(import.meta.dirname, '.scratch-cli-'))
  scratch.push(dir)
  return join(dir, 'catalog.sqlite')
}

function readerFixture(): GitHubReader {
  return {
    searchCode: vi.fn(async () => ({ items: [], total_count: 0, incomplete_results: false })),
    getRepository: vi.fn(async (owner: string, repo: string) =>
      owner === 'alpha'
        ? {
            kind: 'found' as const,
            data: {
              html_url: `https://github.com/${owner}/${repo}`,
              name: repo,
              owner: { login: owner, html_url: `https://github.com/${owner}` },
              description: 'A repository',
              stargazers_count: 2,
              forks_count: 1,
              subscribers_count: 1,
              pushed_at: '2026-09-01T00:00:00Z',
            },
          }
        : { kind: 'not-found' as const },
    ),
    getMarketplace: vi.fn(async () => ({ kind: 'found' as const, data: { plugins: [] } })),
  }
}

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('CLI', () => {
  it('seeds explicit CSV paths and inspects only aggregate state', () => {
    const db = databasePath()
    const args = ['--repos', join(fixtures, 'repos.csv'), '--stats', join(fixtures, 'stats.csv')]
    const seeded = cli(['seed', ...args], db)
    expect(seeded.status).toBe(0)
    expect(seeded.stdout).toMatch(/imported/)
    const inspected = cli(['inspect'], db)
    expect(inspected.status).toBe(0)
    const result = JSON.parse(inspected.stdout)
    expect(result).toMatchObject({
      repositories: 5,
      nonemptyUrls: 3,
      missingUrls: 2,
      stats: 2,
      maxRepositoryId: 14,
      integrity: 'ok',
      state: 'imported',
    })
    expect(inspected.stdout).not.toContain('https://github.com/')
    expect(cli(['seed', ...args], db).stdout).toMatch(/already-imported/)
  })

  it('fails if seed-if-empty has no CSVs on a fresh database', () => {
    const result = cli(['seed-if-empty'], databasePath())
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/missing_csv/i)
  })

  it('prints CSV coordinates but never the submitted value or filename', () => {
    const path = databasePath()
    const repos = join(path, '../with-private-name.csv')
    writeFileSync(repos, readFileSync(join(fixtures, 'repos.csv'), 'utf8').replace('99,0,1,plain', 'secret-value,0,1,plain'))
    const result = cli(['seed', '--repos', repos, '--stats', join(fixtures, 'stats.csv')], path)
    expect(result.status).toBe(1)
    expect(JSON.parse(result.stderr)).toMatchObject({
      category: 'input_or_storage_error',
      validation: { table: 'repos', row: 3, column: 3 },
    })
    expect(result.stderr).not.toMatch(/secret-value|with-private-name/)
  })

  it('formats snapshot issue counts and safe paths without echoing arbitrary exception text', () => {
    const message = formatCliError(new PublicationError('snapshot_invalid', { count: 2, paths: ['repos[0].owner', 'stats[1].size'] }))
    expect(JSON.parse(message)).toMatchObject({
      category: 'snapshot_invalid',
      validation: { count: 2, paths: ['repos[0].owner', 'stats[1].size'] },
    })
    expect(formatCliError(new Error('private-token'))).not.toContain('private-token')
  })

  it('rejects unknown flags instead of silently ignoring them', () => {
    const result = cli(['seed', '--unknown'], databasePath())
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/invalid_option/i)
  })

  it('rejects an option supplied as another option value', () => {
    const result = cli(['seed', '--repos', '--stats'], databasePath())
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/invalid_option/i)
  })

  it('seed-if-empty does not require CSVs after successful seeding', () => {
    const db = databasePath()
    const args = ['--repos', join(fixtures, 'repos.csv'), '--stats', join(fixtures, 'stats.csv')]
    expect(cli(['seed', ...args], db).status).toBe(0)
    expect(cli(['seed-if-empty'], db).stdout).toMatch(/already-imported/)
  })

  it('exports a prepared draft without Git credentials or touching the public UI files', async () => {
    const path = databasePath()
    expect(cli(['seed', '--repos', join(fixtures, 'repos.csv'), '--stats', join(fixtures, 'stats.csv')], path).status).toBe(0)
    const db = openDatabase(path)
    const now = new Date('2026-09-23T12:00:00.000Z')
    beginRun(db, 'preview', now.toISOString())
    completeRun(db, 'preview', now.toISOString(), 0)
    prepareDraft(db, 'preview', now)
    db.close()
    const directory = join(dirname(path), 'preview')
    const output = vi.fn()
    const git = vi.fn()

    await runCli(['export', '--run-id', 'preview', '--output-dir', directory], {
      env: { DB_PATH: path, PUBLISH_ENABLED: 'false' },
      output,
      git,
    })

    expect(JSON.parse(output.mock.calls[0]?.[0])).toEqual({ status: 'exported', runId: 'preview', directory })
    expect(readFileSync(join(directory, 'README.md'), 'utf8')).toContain('with 2 total repositories indexed.')
    expect(git).not.toHaveBeenCalled()
    const failure = await runCli(['export', '--run-id', 'preview', '--output-dir', directory], {
      env: { DB_PATH: path },
    }).catch((error: unknown) => error)
    expect(JSON.parse(formatCliError(failure))).toMatchObject({ category: 'export_destination_exists' })
  })

  for (const command of [['crawl'], ['crawl', '--force'], ['crawl', '--dry-run']]) {
    it(`${command.join(' ')} refuses an unseeded database without an API call`, () => {
      const result = cli(command, databasePath())
      expect(result.status).toBe(1)
      expect(result.stderr).toMatch(/configuration|unseeded/i)
      expect(result.stdout).toBe('')
    })
  }

  it('rejects an invalid publish command before opening the DB or constructing a Git client', async () => {
    let opened = false
    await expect(
      runCli(['publish', '--run-id', 'abc'], {
        env: { DB_PATH: 'db', PUBLISH_ENABLED: 'false' },
        open: () => {
          opened = true
          throw new Error('unexpected')
        },
      }),
    ).rejects.toThrow(/configuration/i)
    expect(opened).toBe(false)
  })

  it('rejects malformed crawl flags before opening the DB', async () => {
    let opened = false
    await expect(
      runCli(['crawl', '--unknown'], {
        env: { DB_PATH: 'db', GITHUB_READ_TOKEN: 'token' },
        open: () => {
          opened = true
          throw new Error('unexpected')
        },
      }),
    ).rejects.toThrow(/option/i)
    expect(opened).toBe(false)
  })

  it('skips before 24 hours without constructing reader/notifier/Git; force runs a read-only draft', async () => {
    const path = databasePath()
    const files = ['--repos', join(fixtures, 'repos.csv'), '--stats', join(fixtures, 'stats.csv')]
    expect(cli(['seed', ...files], path).status).toBe(0)
    const setup = openDatabase(path)
    setSetting(setup, 'last_published_at', '2026-09-22T12:01:00.000Z')
    setup.close()
    const reader = readerFixture()
    const createReader = vi.fn(() => reader)
    const output = vi.fn()
    const dependencies = {
      env: { DB_PATH: path, GITHUB_READ_TOKEN: 'fake-read-token', PUBLISH_ENABLED: 'false' },
      now: () => new Date('2026-09-23T12:00:00.000Z'),
      runId: () => 'forced',
      reader: createReader,
      ranges: [[0, 150]] as const,
      output,
    }
    await runCli(['crawl'], dependencies)
    expect(output).toHaveBeenCalledWith('{"status":"not-due"}')
    expect(createReader).not.toHaveBeenCalled()
    await runCli(['crawl', '--force', '--dry-run'], dependencies)
    expect(createReader).toHaveBeenCalledOnce()
    expect(reader.getRepository).toHaveBeenCalled()
    const check = openDatabase(path)
    expect(getRun(check, 'forced')).toMatchObject({ status: 'completed', draft_size: 1 })
    check.close()
  })

  it('does not bypass a stale active-run lock with --force and never makes an API call', async () => {
    const path = databasePath()
    expect(cli(['seed', '--repos', join(fixtures, 'repos.csv'), '--stats', join(fixtures, 'stats.csv')], path).status).toBe(0)
    const setup = openDatabase(path)
    beginRun(setup, 'old-run', '2020-01-01T00:00:00.000Z')
    setup.close()
    const reader = vi.fn()
    await expect(
      runCli(['crawl', '--force'], {
        env: { DB_PATH: path, GITHUB_READ_TOKEN: 'fake-read-token' },
        reader,
      }),
    ).rejects.toMatchObject({ category: 'active_run' })
    expect(reader).not.toHaveBeenCalled()
  })

  it.each(['active_run', 'publication_locked'] as const)(
    'notifies once when a scheduled crawl sees a persisted %s lock',
    async (category) => {
      const path = databasePath()
      expect(cli(['seed', '--repos', join(fixtures, 'repos.csv'), '--stats', join(fixtures, 'stats.csv')], path).status).toBe(0)
      const db = openDatabase(path)
      beginRun(db, 'blocked', '2026-09-22T00:00:00.000Z')
      if (category === 'publication_locked') {
        completeRun(db, 'blocked', '2026-09-22T01:00:00.000Z', 0)
        prepareDraft(db, 'blocked', new Date('2026-09-22T01:00:00.000Z'))
        claimPublicationLease(db, 'blocked', 'publisher')
      }
      db.close()
      const notifyFailure = vi.fn(async () => {})
      const notifier = {
        notifyStart: vi.fn(),
        notifyDryRun: vi.fn(),
        notifySuccess: vi.fn(),
        notifyFailure,
      }
      const dependencies = {
        env: { DB_PATH: path, GITHUB_READ_TOKEN: 'read-token', PUBLISH_ENABLED: 'false' },
        notifier: () => notifier,
        reader: vi.fn(),
      }

      await expect(runCli(['crawl'], dependencies)).rejects.toMatchObject({ category })
      await expect(runCli(['crawl'], dependencies)).rejects.toMatchObject({ category })

      expect(notifyFailure).toHaveBeenCalledOnce()
      expect(notifyFailure).toHaveBeenCalledWith(expect.objectContaining({ runId: 'blocked', reason: category }))
      expect(dependencies.reader).not.toHaveBeenCalled()
      const inspected = openDatabase(path)
      expect(getSetting(inspected, `schedule_alert_${category}_blocked`)).toBe('sent')
      inspected.close()
    },
  )

  it('requires confirmation to recover a stopped crawl and frees the schedule without touching a publication lease', async () => {
    const path = databasePath()
    const db = openDatabase(path)
    beginRun(db, 'interrupted', '2020-01-01T00:00:00.000Z')
    db.close()
    await expect(runCli(['recover-crawl', '--run-id', 'interrupted'], { env: { DB_PATH: path } })).rejects.toThrow()
    const output = vi.fn()
    await runCli(['recover-crawl', '--run-id', 'interrupted', '--confirm-stopped'], {
      env: { DB_PATH: path },
      now: () => new Date('2026-09-23T12:00:00.000Z'),
      output,
    })
    expect(output).toHaveBeenCalledWith(JSON.stringify({ status: 'failed', runId: 'interrupted', reason: 'operator_recovery' }))
    const verified = openDatabase(path)
    expect(getRun(verified, 'interrupted')).toMatchObject({ status: 'failed', last_error: 'operator_recovery' })
    expect(listRunErrors(verified, 'interrupted')).toContainEqual(expect.objectContaining({ error_type: 'operator_recovery' }))
    verified.close()
  })

  it('requires explicit recovery confirmation before taking over an interrupted publisher', async () => {
    const path = databasePath()
    const env = {
      DB_PATH: path,
      GITHUB_PUBLISH_TOKEN: 'write-token',
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_BRANCH: 'main',
      PUBLISH_ENABLED: 'true',
    }
    await expect(runCli(['publish', '--run-id', 'prepared', '--recover'], { env })).rejects.toThrow()
  })

  it('emits safe per-bucket GitHub request and wait totals for the pilot', async () => {
    const path = databasePath()
    expect(cli(['seed', '--repos', join(fixtures, 'repos.csv'), '--stats', join(fixtures, 'stats.csv')], path).status).toBe(0)
    const output = vi.fn()
    await runCli(['crawl', '--dry-run', '--force'], {
      env: { DB_PATH: path, GITHUB_READ_TOKEN: 'private-token', PUBLISH_ENABLED: 'false' },
      runId: () => 'pilot',
      now: () => new Date('2026-09-23T12:00:00.000Z'),
      ranges: [[0, 150]],
      reader: (_config, log) => {
        log?.({ bucket: 'code_search', request: true })
        log?.({ bucket: 'code_search', remaining: 9 })
        log?.({ bucket: 'core', request: true })
        log?.({ bucket: 'core', waitMs: 750 })
        return readerFixture()
      },
      output,
    })
    const report = output.mock.calls.map(([line]) => JSON.parse(line)).find((line) => line.phase === 'github_rate')
    expect(report.buckets).toEqual({
      code_search: { requests: 1, waitMs: 0, lastRemaining: 9 },
      core: { requests: 1, waitMs: 750, lastRemaining: null },
    })
    const draft = output.mock.calls.map(([line]) => JSON.parse(line)).find((line) => line.status === 'draft')
    expect(draft.report).toMatchObject({
      discovery: { successfulRanges: 1 },
      enrichment: { updated: 1 },
      rateBuckets: report.buckets,
      errorCategories: expect.any(Object),
    })
    expect(JSON.stringify(output.mock.calls)).not.toContain('private-token')
  })

  it('rejects a missing Railway mount before creating a database or making an API call', async () => {
    const reader = vi.fn()
    await expect(
      runCli(['crawl', '--force'], {
        env: { DB_PATH: '/data/catalog.sqlite', RAILWAY_PROJECT_ID: 'test', GITHUB_READ_TOKEN: 'fake-read-token' },
        reader,
        open: (path) => openDatabase(path, { railway: true, mountInfo: '34 2 0:1 / / rw - tmpfs tmpfs rw' }),
      }),
    ).rejects.toThrow(/mount|verify|volume/)
    expect(reader).not.toHaveBeenCalled()
  })

  it('publishes only a previously prepared unchanged draft when enabled and never re-runs GitHub', async () => {
    const path = databasePath()
    expect(cli(['seed', '--repos', join(fixtures, 'repos.csv'), '--stats', join(fixtures, 'stats.csv')], path).status).toBe(0)
    const reader = readerFixture()
    const readerFactory = vi.fn(() => reader)
    await runCli(['crawl', '--dry-run', '--force'], {
      env: { DB_PATH: path, GITHUB_READ_TOKEN: 'read-token' },
      reader: readerFactory,
      ranges: [[0, 150]],
      runId: () => 'prepared',
      now: () => new Date('2026-09-23T12:00:00.000Z'),
      output: vi.fn(),
    })
    const git: GitHubGit = {
      getBranchHead: vi.fn(async () => ({ sha: 'a'.repeat(40), treeSha: 'b'.repeat(40) })),
      createTree: vi.fn(async () => 'c'.repeat(40)),
      createCommit: vi.fn(async () => 'd'.repeat(40)),
      updateBranch: vi.fn(async () => {}),
      isCommitReachable: vi.fn(async () => false),
    }
    const notifier = {
      notifyStart: vi.fn(async () => {}),
      notifyDryRun: vi.fn(async () => {}),
      notifyFailure: vi.fn(async () => {}),
      notifySuccess: vi.fn(async () => {}),
    }
    const gitFactory = vi.fn(() => git)
    const env = {
      DB_PATH: path,
      GITHUB_READ_TOKEN: 'read-token',
      GITHUB_PUBLISH_TOKEN: 'write-token',
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_BRANCH: 'main',
      TELEGRAM_BOT_TOKEN: 'bot-token',
      TELEGRAM_CHAT_ID: 'chat-id',
      PUBLISH_ENABLED: 'true',
    }
    const options = { env, reader: readerFactory, git: gitFactory, notifier: () => notifier, output: vi.fn() }
    const changed = openDatabase(path)
    changed.prepare('UPDATE stats SET size = size + 1 WHERE id = 2').run()
    changed.close()
    await expect(runCli(['publish', '--run-id', 'prepared'], options)).rejects.toMatchObject({ category: 'snapshot_changed' })
    expect(git.getBranchHead).not.toHaveBeenCalled()
    expect(notifier.notifyFailure).toHaveBeenCalledOnce()
    const restored = openDatabase(path)
    restored.prepare('UPDATE stats SET size = size - 1 WHERE id = 2').run()
    beginRun(restored, 'other-crawl', '2020-01-01T00:00:00.000Z')
    restored.close()
    await expect(runCli(['publish', '--run-id', 'prepared'], options)).rejects.toMatchObject({ category: 'active_run' })
    expect(git.getBranchHead).not.toHaveBeenCalled()
    expect(git.isCommitReachable).not.toHaveBeenCalled()
    expect(git.updateBranch).not.toHaveBeenCalled()
    expect(notifier.notifyFailure).toHaveBeenCalledWith(expect.objectContaining({ reason: 'active_run', runId: 'prepared' }))
    const locked = openDatabase(path)
    expect(getRun(locked, 'other-crawl')?.status).toBe('running')
    expect(listRunErrors(locked, 'prepared')).toContainEqual(expect.objectContaining({ phase: 'publish', error_type: 'active_run' }))
    failRun(locked, 'other-crawl', '2026-09-23T12:00:00.000Z', 'operator_recovered')
    locked.close()
    await runCli(['publish', '--run-id', 'prepared'], options)
    expect(readerFactory).toHaveBeenCalledOnce()
    expect(git.updateBranch).toHaveBeenCalledOnce()
    expect(notifier.notifySuccess).toHaveBeenCalledWith(expect.objectContaining({ confirmedGitSha: 'd'.repeat(40), deletedCount: 4 }))
    const db = openDatabase(path)
    expect(getRun(db, 'prepared')?.status).toBe('published')
    db.close()
  })

  it('with production credentials and --dry-run never constructs a Git client', async () => {
    const path = databasePath()
    expect(cli(['seed', '--repos', join(fixtures, 'repos.csv'), '--stats', join(fixtures, 'stats.csv')], path).status).toBe(0)
    const git = vi.fn((): GitHubGit => {
      throw new Error('Git client must not be constructed')
    })
    const notifier = {
      notifyStart: vi.fn(async () => {}),
      notifyDryRun: vi.fn(async () => {}),
      notifyFailure: vi.fn(async () => {}),
      notifySuccess: vi.fn(async () => {}),
    }
    await runCli(['crawl', '--dry-run', '--force'], {
      env: {
        DB_PATH: path,
        GITHUB_READ_TOKEN: 'read-token',
        GITHUB_PUBLISH_TOKEN: 'write-token',
        GITHUB_REPOSITORY: 'owner/repo',
        GITHUB_BRANCH: 'main',
        TELEGRAM_BOT_TOKEN: 'bot-token',
        TELEGRAM_CHAT_ID: 'chat-id',
        PUBLISH_ENABLED: 'true',
      },
      reader: () => readerFixture(),
      git,
      notifier: () => notifier,
      ranges: [[0, 150]],
      runId: () => 'production-dry',
      output: vi.fn(),
    })
    expect(git).not.toHaveBeenCalled()
    expect(notifier.notifyDryRun).toHaveBeenCalledOnce()
    expect(notifier.notifySuccess).not.toHaveBeenCalled()
  })

  it('automatically publishes a successful due crawl only when explicitly enabled', async () => {
    const path = databasePath()
    expect(cli(['seed', '--repos', join(fixtures, 'repos.csv'), '--stats', join(fixtures, 'stats.csv')], path).status).toBe(0)
    const reader = readerFixture()
    const git: GitHubGit = {
      getBranchHead: vi.fn(async () => ({ sha: 'a'.repeat(40), treeSha: 'b'.repeat(40) })),
      createTree: vi.fn(async () => 'c'.repeat(40)),
      createCommit: vi.fn(async () => 'd'.repeat(40)),
      updateBranch: vi.fn(async () => {}),
      isCommitReachable: vi.fn(async () => false),
    }
    const notifier = {
      notifyStart: vi.fn(async () => {}),
      notifyDryRun: vi.fn(async () => {}),
      notifyFailure: vi.fn(async () => {}),
      notifySuccess: vi.fn(async () => {}),
    }
    const output = vi.fn()
    await runCli(['crawl'], {
      env: {
        DB_PATH: path,
        GITHUB_READ_TOKEN: 'read-token',
        GITHUB_PUBLISH_TOKEN: 'write-token',
        GITHUB_REPOSITORY: 'owner/repo',
        GITHUB_BRANCH: 'main',
        TELEGRAM_BOT_TOKEN: 'bot-token',
        TELEGRAM_CHAT_ID: 'chat-id',
        PUBLISH_ENABLED: 'true',
      },
      reader: () => reader,
      git: () => git,
      notifier: () => notifier,
      ranges: [[0, 150]],
      runId: () => 'automatic',
      now: () => new Date('2026-09-23T12:00:00.000Z'),
      output,
    })
    expect(reader.searchCode).toHaveBeenCalledOnce()
    expect(git.updateBranch).toHaveBeenCalledOnce()
    expect(notifier.notifySuccess).toHaveBeenCalledWith(expect.objectContaining({ confirmedGitSha: 'd'.repeat(40) }))
    expect(JSON.parse(output.mock.calls[0]?.[0])).toMatchObject({
      status: 'published',
      runId: 'automatic',
      sha: 'd'.repeat(40),
      report: { enrichment: { updated: 1 } },
    })
    const db = openDatabase(path)
    expect(getRun(db, 'automatic')?.status).toBe('published')
    expect(db.prepare('SELECT COUNT(*) AS n FROM stats WHERE run_id = ?').get('automatic')).toEqual({ n: 1 })
    db.close()
  })
})
