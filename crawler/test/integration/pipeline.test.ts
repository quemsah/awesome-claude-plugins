import Database from 'better-sqlite3'
import { afterEach, expect, it } from 'vitest'
import { GitHubClient } from '../../src/github/client.js'
import { GitHubGitClient } from '../../src/publish/githubGit.js'
import { executeCrawl } from '../../src/service/execute.js'
import { getRun } from '../../src/storage/runs.js'
import { initializeSchema } from '../../src/storage/schema.js'

const databases: Database.Database[] = []

afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})

it('runs discovery, enrichment, snapshot generation and Git publication through real clients', async () => {
  const db = new Database(':memory:')
  initializeSchema(db)
  databases.push(db)

  const baseSha = 'a'.repeat(40)
  const baseTree = 'b'.repeat(40)
  const treeSha = 'c'.repeat(40)
  const commitSha = 'd'.repeat(40)
  const treeBodies: unknown[] = []
  let now = 0

  const readFetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.pathname === '/search/code') {
      return Response.json({
        total_count: 1,
        incomplete_results: false,
        items: [
          {
            repository: {
              html_url: 'https://github.com/acme/catalog',
              description: 'discovered',
              private: false,
            },
          },
        ],
      })
    }
    if (url.pathname === '/repos/acme/catalog') {
      return Response.json({
        html_url: 'https://github.com/acme/catalog',
        name: 'catalog',
        description: 'enriched',
        stargazers_count: 12,
        forks_count: 2,
        subscribers_count: 3,
        pushed_at: '2026-09-23T00:00:00Z',
        private: false,
        owner: { login: 'acme', html_url: 'https://github.com/acme' },
      })
    }
    if (url.pathname === '/repos/acme/catalog/contents/.claude-plugin/marketplace.json') {
      return Response.json({
        encoding: 'base64',
        content: Buffer.from(JSON.stringify({ plugins: [{ name: 'one' }, { name: 'two' }] })).toString('base64'),
      })
    }
    throw new Error(`Unexpected read request: ${url.pathname}`)
  }) as typeof fetch

  const gitFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url.pathname === '/repos/acme/awesome/git/ref/heads/main') {
      return Response.json({ object: { type: 'commit', sha: baseSha } })
    }
    if (method === 'GET' && url.pathname === `/repos/acme/awesome/git/commits/${baseSha}`) {
      return Response.json({ sha: baseSha, tree: { sha: baseTree }, parents: [] })
    }
    if (method === 'POST' && url.pathname === '/repos/acme/awesome/git/trees') {
      treeBodies.push(JSON.parse(String(init?.body)))
      return Response.json({ sha: treeSha })
    }
    if (method === 'POST' && url.pathname === '/repos/acme/awesome/git/commits') {
      return Response.json({ sha: commitSha })
    }
    if (method === 'PATCH' && url.pathname === '/repos/acme/awesome/git/refs/heads/main') {
      return Response.json({ object: { type: 'commit', sha: commitSha } })
    }
    throw new Error(`Unexpected Git request: ${method} ${url.pathname}`)
  }) as typeof fetch

  const reader = new GitHubClient({
    token: 'read-token',
    fetch: readFetch,
    clock: {
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds
      },
    },
    random: () => 0,
  })
  const git = new GitHubGitClient({
    token: 'publish-token',
    owner: 'acme',
    repo: 'awesome',
    branch: 'main',
    fetch: gitFetch,
  })

  const result = await executeCrawl(db, reader, 'pipeline-e2e', {
    dryRun: false,
    git,
    ranges: [[0, 150]],
    now: () => new Date('2026-09-23T12:00:00.000Z'),
  })

  expect(result).toMatchObject({ status: 'published', runId: 'pipeline-e2e', sha: commitSha })
  expect(getRun(db, 'pipeline-e2e')).toMatchObject({ status: 'published', commit_sha: commitSha })
  expect(db.prepare('SELECT html_url, stargazers_count, plugins_count FROM repositories').all()).toEqual([
    { html_url: 'https://github.com/acme/catalog', stargazers_count: 12, plugins_count: 2 },
  ])

  expect(treeBodies).toHaveLength(1)
  const tree = treeBodies[0] as { tree: Array<{ path: string; content: string }> }
  expect(tree.tree.map(({ path }) => path)).toEqual(['README.md', 'ui/src/data/repos.json', 'ui/src/data/stats.json'])
  const repos = JSON.parse(tree.tree.find(({ path }) => path === 'ui/src/data/repos.json')?.content ?? 'null')
  expect(repos).toEqual([
    expect.objectContaining({
      html_url: 'https://github.com/acme/catalog',
      repo_name: 'catalog',
      stargazers_count: 12,
      plugins_count: 2,
    }),
  ])
})
