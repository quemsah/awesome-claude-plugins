import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { type GitHubReader, GitHubTemporaryError } from '../github/client.js'
import type { GitHubGit } from '../publish/githubGit.js'
import { ShutdownError } from '../shutdown.js'
import { populateFixture } from '../storage/fixtureDb.js'
import { beginRun, getRun, getSetting, listRunErrors, setSetting } from '../storage/runs.js'
import { initializeSchema } from '../storage/schema.js'
import { executeCrawl, executePublish } from './execute.js'

const now = () => new Date('2026-09-23T12:00:00.000Z')
const range = [[0, 150]] as const
const reader: GitHubReader = {
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

async function dbFixture() {
  const db = new Database(':memory:')
  initializeSchema(db)
  populateFixture(db)
  return db
}

function notifier() {
  return {
    notifyStart: vi.fn(async () => {}),
    notifyDryRun: vi.fn(async () => {}),
    notifyFailure: vi.fn(async () => {}),
    notifySuccess: vi.fn(async () => {}),
  }
}

describe('orchestration', () => {
  it('dry-run reads GitHub, persists a draft and never calls Git or announces publication', async () => {
    const db = await dbFixture()
    const notify = notifier()
    const git = { updateBranch: vi.fn() } as unknown as GitHubGit
    const result = await executeCrawl(db, reader, 'dry', { now, ranges: range, dryRun: true, git, notifier: notify })
    expect(result).toMatchObject({ status: 'draft', runId: 'dry' })
    expect(getRun(db, 'dry')).toMatchObject({ status: 'completed', draft_id: 8, draft_size: 1 })
    expect(notify.notifyStart).toHaveBeenCalledOnce()
    expect(notify.notifyDryRun).toHaveBeenCalledOnce()
    expect(notify.notifySuccess).not.toHaveBeenCalled()
    expect(git.updateBranch).not.toHaveBeenCalled()
    expect(db.prepare('SELECT COUNT(*) AS n FROM stats').get()).toEqual({ n: 2 })
    db.close()
  })

  it('exposes and persists all crawl outcomes, failure categories and GitHub bucket usage', async () => {
    const db = await dbFixture()
    const notify = notifier()
    const rateBuckets = {
      code_search: { requests: 2, waitMs: 700, lastRemaining: 8 },
      core: { requests: 9, waitMs: 3000, lastRemaining: 4900 },
    }
    try {
      const result = await executeCrawl(db, reader, 'report', {
        now,
        ranges: range,
        dryRun: true,
        notifier: notify,
        rateBuckets: () => rateBuckets,
      })
      expect(result).toMatchObject({
        report: {
          discovery: { successfulRanges: 1 },
          enrichment: { updated: 1, deleted404: 2, deletedBlankUrl: 2 },
          errorCategories: {},
          rateBuckets,
        },
      })
      expect(result.report.durationMs).toEqual(expect.any(Number))
      const report = JSON.parse(getSetting(db, 'run_report_report') ?? 'null')
      expect(report).toMatchObject(result.report)
      expect(notify.notifyDryRun).toHaveBeenCalledWith(
        expect.objectContaining({
          enrichment: result.report.enrichment,
          errorCategories: {},
          rateBuckets,
          durationMs: result.report.durationMs,
        }),
      )
    } finally {
      db.close()
    }
  })

  it('reports failures with a safe category and records them without a Git write', async () => {
    const db = await dbFixture()
    const notify = notifier()
    const failing: GitHubReader = {
      ...reader,
      searchCode: async () => {
        throw new GitHubTemporaryError('read-secret inside body', 503)
      },
    }
    await expect(executeCrawl(db, failing, 'failed', { now, ranges: range, dryRun: true, notifier: notify })).rejects.toThrow()
    expect(getRun(db, 'failed')?.status).toBe('failed')
    expect(notify.notifyFailure).toHaveBeenCalledWith(expect.objectContaining({ reason: 'no_successful_ranges' }))
    expect(JSON.stringify(listRunErrors(db, 'failed'))).not.toContain('read-secret')
    db.close()
  })

  it('preserves a completed draft after publish notification failure and never repeats a Git write', async () => {
    const db = await dbFixture()
    const rateBuckets = {
      code_search: { requests: 3, waitMs: 500, lastRemaining: 7 },
      core: { requests: 11, waitMs: 1000, lastRemaining: 4800 },
    }
    await executeCrawl(db, reader, 'prepared', { now, ranges: range, dryRun: true, rateBuckets: () => rateBuckets })
    const git = {
      getBranchHead: vi.fn(async () => ({ sha: 'a'.repeat(40), treeSha: 'b'.repeat(40) })),
      createTree: vi.fn(async () => 'c'.repeat(40)),
      createCommit: vi.fn(async () => 'd'.repeat(40)),
      updateBranch: vi.fn(async () => {}),
      isCommitReachable: vi.fn(async () => false),
    }
    const notify = notifier()
    notify.notifySuccess.mockRejectedValueOnce(new Error('bot-secret'))
    const log = vi.fn()
    const result = await executePublish(db, git, 'prepared', { now, notifier: notify, log, writeEnabled: true })
    expect(result).toMatchObject({ status: 'published', sha: 'd'.repeat(40) })
    expect(result.report).toMatchObject({
      discovery: { successfulRanges: 1 },
      enrichment: { updated: 1 },
      warningCount: 0,
      errorCategories: {},
      rateBuckets,
    })
    expect(getRun(db, 'prepared')?.status).toBe('published')
    expect(listRunErrors(db, 'prepared')).toContainEqual(expect.objectContaining({ phase: 'notify', error_type: 'delivery_failed' }))
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ phase: 'notify', category: 'delivery_failed' }))
    expect(git.updateBranch).toHaveBeenCalledOnce()
    expect(notify.notifySuccess).toHaveBeenCalledWith(
      expect.objectContaining({ deletedCount: 4, rateBuckets, confirmedGitSha: 'd'.repeat(40) }),
    )
    db.close()
  })

  it('records start and failure notification errors as categories without masking the crawl failure', async () => {
    const db = await dbFixture()
    const notify = notifier()
    notify.notifyStart.mockRejectedValueOnce(new Error('start contains bot-token'))
    notify.notifyFailure.mockRejectedValueOnce(new Error('failure contains bot-token'))
    const log = vi.fn()
    const failing: GitHubReader = {
      ...reader,
      searchCode: async () => {
        throw new GitHubTemporaryError('read-secret', 503)
      },
    }
    await expect(
      executeCrawl(db, failing, 'failed-notify', { now, ranges: range, dryRun: true, notifier: notify, log }),
    ).rejects.toMatchObject({
      category: 'no_successful_ranges',
    })
    expect(getRun(db, 'failed-notify')?.status).toBe('failed')
    expect(listRunErrors(db, 'failed-notify').filter((row) => row.phase === 'notify')).toHaveLength(2)
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ phase: 'notify', category: 'delivery_failed' }))
    expect(JSON.stringify(listRunErrors(db, 'failed-notify'))).not.toMatch(/bot-token|read-secret/)
    db.close()
  })

  it('refuses changed drafts without invoking Git and notifies failure', async () => {
    const db = await dbFixture()
    await executeCrawl(db, reader, 'prepared', { now, ranges: range, dryRun: true })
    db.prepare('UPDATE stats SET size = size + 1 WHERE id = 2').run()
    const git = { getBranchHead: vi.fn() } as unknown as GitHubGit
    const notify = notifier()
    await expect(executePublish(db, git, 'prepared', { now, notifier: notify, writeEnabled: true })).rejects.toMatchObject({
      category: 'snapshot_changed',
    })
    expect(git.getBranchHead).not.toHaveBeenCalled()
    expect(notify.notifyFailure).toHaveBeenCalledOnce()
    db.close()
  })

  it('rejects a corrupt stored report before performing any Git write', async () => {
    const db = await dbFixture()
    try {
      await executeCrawl(db, reader, 'prepared', { now, ranges: range, dryRun: true })
      setSetting(db, 'run_report_prepared', 'not JSON')
      const git = { getBranchHead: vi.fn() } as unknown as GitHubGit
      await expect(executePublish(db, git, 'prepared', { now, writeEnabled: true })).rejects.toThrow()
      expect(git.getBranchHead).not.toHaveBeenCalled()
      expect(getRun(db, 'prepared')?.status).toBe('completed')
    } finally {
      db.close()
    }
  })

  it('refuses publication while another crawl is active, without even reading Git', async () => {
    const db = await dbFixture()
    await executeCrawl(db, reader, 'prepared', { now, ranges: range, dryRun: true })
    beginRun(db, 'ongoing', '2026-09-23T12:01:00.000Z')
    const git = {
      getBranchHead: vi.fn(),
      isCommitReachable: vi.fn(),
      createTree: vi.fn(),
      createCommit: vi.fn(),
      updateBranch: vi.fn(),
    } as unknown as GitHubGit
    const notify = notifier()
    const log = vi.fn()

    await expect(executePublish(db, git, 'prepared', { now, notifier: notify, log, writeEnabled: true })).rejects.toMatchObject({
      category: 'active_run',
    })
    expect(git.getBranchHead).not.toHaveBeenCalled()
    expect(git.isCommitReachable).not.toHaveBeenCalled()
    expect(git.createTree).not.toHaveBeenCalled()
    expect(git.createCommit).not.toHaveBeenCalled()
    expect(git.updateBranch).not.toHaveBeenCalled()
    expect(notify.notifyFailure).toHaveBeenCalledWith(expect.objectContaining({ reason: 'active_run', runId: 'prepared' }))
    expect(listRunErrors(db, 'prepared')).toContainEqual(expect.objectContaining({ phase: 'publish', error_type: 'active_run' }))
    expect(getRun(db, 'ongoing')?.status).toBe('running')
    db.close()
  })

  it('blocks a crawl that tries to begin while publication reads Git', async () => {
    const db = await dbFixture()
    await executeCrawl(db, reader, 'prepared', { now, ranges: range, dryRun: true })
    const git: GitHubGit = {
      getBranchHead: vi.fn(async () => {
        expect(() => beginRun(db, 'late-run', '2026-09-23T12:01:00.000Z')).toThrow()
        return { sha: 'a'.repeat(40), treeSha: 'b'.repeat(40) }
      }),
      createTree: vi.fn(async () => 'c'.repeat(40)),
      createCommit: vi.fn(async () => 'd'.repeat(40)),
      updateBranch: vi.fn(async () => {}),
      isCommitReachable: vi.fn(async () => false),
    }
    const notify = notifier()
    await expect(executePublish(db, git, 'prepared', { now, notifier: notify, log: vi.fn(), writeEnabled: true })).resolves.toMatchObject({
      status: 'published',
    })
    expect(git.updateBranch).toHaveBeenCalledOnce()
    expect(notify.notifySuccess).toHaveBeenCalledOnce()
    expect(getRun(db, 'late-run')).toBeNull()
    db.close()
  })
})

it('does not record a notification delivery failure when shutdown cancels the failure notification', async () => {
  const db = await dbFixture()
  const shutdown = new AbortController()
  const notify = notifier()
  notify.notifyFailure.mockRejectedValueOnce(new ShutdownError())
  const terminatingReader: GitHubReader = {
    ...reader,
    searchCode: async () => {
      shutdown.abort()
      return { items: [], total_count: 0, incomplete_results: false }
    },
  }

  await expect(
    executeCrawl(db, terminatingReader, 'shutdown-notify', {
      now,
      ranges: range,
      dryRun: true,
      notifier: notify,
      signal: shutdown.signal,
    }),
  ).rejects.toMatchObject({ category: 'terminated' })

  expect(getRun(db, 'shutdown-notify')).toMatchObject({ status: 'failed', last_error: 'terminated' })
  expect(listRunErrors(db, 'shutdown-notify').filter((row) => row.phase === 'notify')).toHaveLength(0)
  db.close()
})

it('keeps the publication lease when shutdown arrives after a candidate commit but before the Git ref update', async () => {
  const db = await dbFixture()
  await executeCrawl(db, reader, 'shutdown-publish', { now, ranges: range, dryRun: true })
  const shutdown = new AbortController()
  const pending = 'd'.repeat(40)
  const git: GitHubGit = {
    getBranchHead: vi.fn(async () => ({ sha: 'a'.repeat(40), treeSha: 'b'.repeat(40) })),
    createTree: vi.fn(async () => 'c'.repeat(40)),
    createCommit: vi.fn(async () => {
      shutdown.abort()
      return pending
    }),
    updateBranch: vi.fn(async () => {}),
    isCommitReachable: vi.fn(async () => false),
  }

  await expect(
    executePublish(db, git, 'shutdown-publish', {
      now,
      signal: shutdown.signal,
      writeEnabled: true,
      log: vi.fn(),
    }),
  ).rejects.toMatchObject({ category: 'terminated' })

  expect(git.updateBranch).not.toHaveBeenCalled()
  expect(getRun(db, 'shutdown-publish')).toMatchObject({
    status: 'completed',
    pending_commit_sha: pending,
  })
  expect(db.prepare('SELECT run_id FROM publication_lease').get()).toEqual({ run_id: 'shutdown-publish' })
  expect(db.prepare("SELECT COUNT(*) AS n FROM stats WHERE run_id = 'shutdown-publish'").get()).toEqual({ n: 0 })
  db.close()
})

it('preserves shutdown as terminated when Git branch-head retrieval aborts', async () => {
  const db = await dbFixture()
  await executeCrawl(db, reader, 'shutdown-head', { now, ranges: range, dryRun: true })
  const git: GitHubGit = {
    getBranchHead: vi.fn(async () => {
      throw new ShutdownError()
    }),
    createTree: vi.fn(async () => 'c'.repeat(40)),
    createCommit: vi.fn(async () => 'd'.repeat(40)),
    updateBranch: vi.fn(async () => {}),
    isCommitReachable: vi.fn(async () => false),
  }

  await expect(executePublish(db, git, 'shutdown-head', { now, writeEnabled: true, log: vi.fn() })).rejects.toMatchObject({
    category: 'terminated',
  })

  expect(git.createTree).not.toHaveBeenCalled()
  expect(git.createCommit).not.toHaveBeenCalled()
  expect(git.updateBranch).not.toHaveBeenCalled()
  expect(listRunErrors(db, 'shutdown-head')).toContainEqual(expect.objectContaining({ phase: 'publish', error_type: 'terminated' }))
  db.close()
})
