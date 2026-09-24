import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatCliError, runCli } from '../src/cli.js'
import type { GitHubReader } from '../src/github/client.js'
import type { GitHubGit } from '../src/publish/githubGit.js'
import { PublicationError, prepareDraft } from '../src/publish/publishRun.js'
import { openDatabase } from '../src/storage/db.js'
import { populateFixture } from '../src/storage/fixtureDb.js'
import { inspect } from '../src/storage/inspect.js'
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

function populateTestDatabase(path: string) {
  const db = openDatabase(path)
  populateFixture(db)
  db.close()
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
  it('inspects only aggregate state', () => {
    const db = databasePath()
    populateTestDatabase(db)
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
      foreignKeyViolations: [],
    })
    expect(inspected.stdout).not.toContain('https://github.com/')
  })

  it('counts blank URLs as missing and reports foreign key violations', () => {
    const db = openDatabase(databasePath())
    populateFixture(db)
    db.prepare(
      "INSERT INTO repositories (html_url, createdAt, updatedAt) VALUES ('', 'now', 'now'), (char(9) || ' ' || char(10), 'now', 'now')",
    ).run()
    db.pragma('foreign_keys = OFF')
    db.prepare("INSERT INTO stats (date, size, createdAt, updatedAt, run_id) VALUES ('orphan', 0, 'now', 'now', 'missing-run')").run()

    expect(inspect(db)).toMatchObject({
      nonemptyUrls: 3,
      missingUrls: 4,
      foreignKeyViolations: [{ table: 'stats', parent: 'runs', fkid: 0 }],
    })
    db.close()
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
    const result = cli(['inspect', '--unknown'], databasePath())
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/invalid_option/i)
  })

  it('runs explicit maintenance and prunes old terminal runs', async () => {
    const path = databasePath()
    const db = openDatabase(path)
    beginRun(db, 'old-maintenance', '2026-01-01T00:00:00.000Z')
    failRun(db, 'old-maintenance', '2026-01-01T01:00:00.000Z', 'operator_recovery')
    db.close()
    const output = vi.fn()

    await runCli(['maintenance'], {
      env: { DB_PATH: path },
      now: () => new Date('2026-09-24T00:00:00.000Z'),
      output,
    })

    expect(JSON.parse(output.mock.calls[0]?.[0])).toMatchObject({ status: 'maintained', runsDeleted: 1 })
    const verified = openDatabase(path)
    expect(getRun(verified, 'old-maintenance')).toBeNull()
    verified.close()
  })

  it('prunes old terminal runs before starting a crawl', async () => {
    const path = databasePath()
    populateTestDatabase(path)
    const setup = openDatabase(path)
    beginRun(setup, 'old-before-crawl', '2026-01-01T00:00:00.000Z')
    failRun(setup, 'old-before-crawl', '2026-01-01T01:00:00.000Z', 'operator_recovery')
    setup.close()

    await runCli(['crawl', '--dry-run'], {
      env: { DB_PATH: path, GITHUB_READ_TOKEN: 'read-token', PUBLISH_ENABLED: 'false' },
      now: () => new Date('2026-09-24T00:00:00.000Z'),
      runId: () => 'after-maintenance',
      reader: () => readerFixture(),
      ranges: [[0, 150]],
      output: vi.fn(),
    })

    const verified = openDatabase(path)
    expect(getRun(verified, 'old-before-crawl')).toBeNull()
    expect(getRun(verified, 'after-maintenance')).toMatchObject({ status: 'completed' })
    verified.close()
  })

  it('exports a prepared draft without Git credentials or touching the public UI files', async () => {
    const path = databasePath()
    populateTestDatabase(path)
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

  it('runs despite a recent publication and supports a read-only draft', async () => {
    const path = databasePath()
    populateTestDatabase(path)
    const setup = openDatabase(path)
    setSetting(setup, 'last_published_at', '2026-09-22T12:01:00.000Z')
    setup.close()
    const reader = readerFixture()
    const createReader = vi.fn(() => reader)
    const output = vi.fn()
    const dependencies = {
      env: { DB_PATH: path, GITHUB_READ_TOKEN: 'fake-read-token', PUBLISH_ENABLED: 'false' },
      now: () => new Date('2026-09-23T12:00:00.000Z'),
      runId: () => 'cron-run',
      reader: createReader,
      ranges: [[0, 150]] as const,
      output,
    }
    await runCli(['crawl', '--dry-run'], dependencies)
    expect(createReader).toHaveBeenCalledOnce()
    expect(reader.getRepository).toHaveBeenCalled()
    const check = openDatabase(path)
    expect(getRun(check, 'cron-run')).toMatchObject({ status: 'completed', draft_size: 1 })
    check.close()
  })

  it('skips a fresh active run without making an API call or crashing the scheduler', async () => {
    const path = databasePath()
    populateTestDatabase(path)
    const setup = openDatabase(path)
    beginRun(setup, 'active-run', '2026-09-24T00:30:00.000Z')
    setup.close()
    const reader = vi.fn()
    const output = vi.fn()

    await runCli(['crawl'], {
      env: { DB_PATH: path, GITHUB_READ_TOKEN: 'fake-read-token' },
      now: () => new Date('2026-09-24T01:00:00.000Z'),
      reader,
      output,
    })

    expect(reader).not.toHaveBeenCalled()
    expect(output).toHaveBeenCalledWith(JSON.stringify({ status: 'skipped', reason: 'active_run', runId: 'active-run' }))
    const verified = openDatabase(path)
    expect(getRun(verified, 'active-run')?.status).toBe('running')
    verified.close()
  })

  it('skips a concurrent crawl that starts after preflight without creating a losing run', async () => {
    const path = databasePath()
    populateTestDatabase(path)
    let db: ReturnType<typeof openDatabase> | undefined
    let nowCalls = 0
    const reader = vi.fn()
    const output = vi.fn()
    const notifyFailure = vi.fn(async () => {})
    const notifier = {
      notifyStart: vi.fn(async () => {}),
      notifyDryRun: vi.fn(async () => {}),
      notifySuccess: vi.fn(async () => {}),
      notifyFailure,
    }

    await runCli(['crawl'], {
      env: { DB_PATH: path, GITHUB_READ_TOKEN: 'fake-read-token', PUBLISH_ENABLED: 'false' },
      open: (dbPath) => {
        db = openDatabase(dbPath)
        return db
      },
      now: () => {
        nowCalls++
        if (nowCalls === 3) {
          if (!db) throw new Error('Database must be open before the concurrent start')
          beginRun(db, 'concurrent-run', '2026-09-24T01:00:00.000Z')
        }
        return new Date('2026-09-24T01:00:00.000Z')
      },
      runId: () => 'losing-run',
      reader,
      notifier: () => notifier,
      output,
    })

    expect(reader).not.toHaveBeenCalled()
    expect(notifier.notifyStart).not.toHaveBeenCalled()
    expect(notifyFailure).toHaveBeenCalledOnce()
    expect(notifyFailure).toHaveBeenCalledWith(expect.objectContaining({ runId: 'concurrent-run', reason: 'active_run' }))
    expect(output).toHaveBeenCalledWith(JSON.stringify({ status: 'skipped', reason: 'active_run', runId: 'concurrent-run' }))

    const verified = openDatabase(path)
    expect(getRun(verified, 'concurrent-run')?.status).toBe('running')
    expect(getRun(verified, 'losing-run')).toBeNull()
    verified.close()
  })

  it('fails a claimed run when crawl setup throws before execution', async () => {
    const path = databasePath()
    populateTestDatabase(path)

    await expect(
      runCli(['crawl'], {
        env: { DB_PATH: path, GITHUB_READ_TOKEN: 'fake-read-token', PUBLISH_ENABLED: 'false' },
        now: () => new Date('2026-09-24T01:00:00.000Z'),
        runId: () => 'setup-failure',
        reader: () => {
          throw new Error('reader setup failed')
        },
        output: vi.fn(),
      }),
    ).rejects.toThrow('reader setup failed')

    const verified = openDatabase(path)
    expect(getRun(verified, 'setup-failure')).toMatchObject({ status: 'failed', last_error: 'startup_failed' })
    verified.close()
  })

  it('recovers a stale active run and starts the scheduled crawl', async () => {
    const path = databasePath()
    populateTestDatabase(path)
    const setup = openDatabase(path)
    beginRun(setup, 'stale-run', '2026-09-23T20:00:00.000Z')
    setup.close()
    const reader = readerFixture()

    await runCli(['crawl', '--dry-run'], {
      env: { DB_PATH: path, GITHUB_READ_TOKEN: 'fake-read-token', PUBLISH_ENABLED: 'false' },
      now: () => new Date('2026-09-24T01:00:00.000Z'),
      runId: () => 'replacement-run',
      reader: () => reader,
      ranges: [[0, 150]],
      output: vi.fn(),
    })

    expect(reader.searchCode).toHaveBeenCalledOnce()
    const verified = openDatabase(path)
    expect(getRun(verified, 'stale-run')).toMatchObject({ status: 'failed', last_error: 'stale_run' })
    expect(listRunErrors(verified, 'stale-run')).toContainEqual(expect.objectContaining({ phase: 'crawl', error_type: 'stale_run' }))
    expect(getRun(verified, 'replacement-run')?.status).toBe('completed')
    verified.close()
  })

  it.each(['active_run', 'publication_locked'] as const)('notifies once when a crawl sees a persisted %s lock', async (category) => {
    const path = databasePath()
    populateTestDatabase(path)
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
      now: () => new Date('2026-09-22T01:30:00.000Z'),
      notifier: () => notifier,
      reader: vi.fn(),
    }

    if (category === 'active_run') {
      await runCli(['crawl'], dependencies)
      await runCli(['crawl'], dependencies)
    } else {
      await expect(runCli(['crawl'], dependencies)).rejects.toMatchObject({ category })
      await expect(runCli(['crawl'], dependencies)).rejects.toMatchObject({ category })
    }

    expect(notifyFailure).toHaveBeenCalledOnce()
    expect(notifyFailure).toHaveBeenCalledWith(expect.objectContaining({ runId: 'blocked', reason: category }))
    expect(dependencies.reader).not.toHaveBeenCalled()
    const inspected = openDatabase(path)
    expect(getSetting(inspected, `schedule_alert_${category}_blocked`)).toBe('sent')
    inspected.close()
  })

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
    populateTestDatabase(path)
    const output = vi.fn()
    await runCli(['crawl', '--dry-run'], {
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
      runCli(['crawl'], {
        env: { DB_PATH: '/data/catalog.sqlite', RAILWAY_PROJECT_ID: 'test', GITHUB_READ_TOKEN: 'fake-read-token' },
        reader,
        open: (path) => openDatabase(path, { railway: true, mountInfo: '34 2 0:1 / / rw - tmpfs tmpfs rw' }),
      }),
    ).rejects.toThrow(/mount|verify|volume/)
    expect(reader).not.toHaveBeenCalled()
  })

  it('publishes only a previously prepared unchanged draft when enabled and never re-runs GitHub', async () => {
    const path = databasePath()
    populateTestDatabase(path)
    const reader = readerFixture()
    const readerFactory = vi.fn(() => reader)
    await runCli(['crawl', '--dry-run'], {
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
    populateTestDatabase(path)
    const git = vi.fn((): GitHubGit => {
      throw new Error('Git client must not be constructed')
    })
    const notifier = {
      notifyStart: vi.fn(async () => {}),
      notifyDryRun: vi.fn(async () => {}),
      notifyFailure: vi.fn(async () => {}),
      notifySuccess: vi.fn(async () => {}),
    }
    await runCli(['crawl', '--dry-run'], {
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
    populateTestDatabase(path)
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
