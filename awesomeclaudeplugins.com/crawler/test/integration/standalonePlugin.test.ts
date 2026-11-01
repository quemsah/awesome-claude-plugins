import { PublishedReposArraySchema } from '@awesome-claude-plugins/catalog-contract'
import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { GitHubClient } from '../../src/github/client.js'
import { readDraftSnapshot } from '../../src/publish/publishRun.js'
import { executeCrawl } from '../../src/service/execute.js'
import { initializeSchema } from '../../src/storage/schema.js'

it.each(['code', 'repository'])('indexes a standalone discovered only through %s search into a validated draft', async (source) => {
  const db = new Database(':memory:')
  try {
    initializeSchema(db)
    let clock = Date.parse('2026-11-01T00:00:00Z')
    const paths: string[] = []
    const repository = {
      html_url: 'https://github.com/acme/reviewer',
      name: 'reviewer',
      owner: { login: 'acme', html_url: 'https://github.com/acme' },
      description: null,
      stargazers_count: 0,
      forks_count: 0,
      subscribers_count: 0,
      private: false,
      pushed_at: '2026-10-31T00:00:00Z',
    }
    const reader = new GitHubClient({
      token: 'test-token',
      clock: {
        now: () => clock,
        sleep: async (ms) => {
          clock += ms
        },
      },
      fetch: (async (input) => {
        const url = new URL(String(input))
        paths.push(url.pathname)
        if (url.pathname === '/search/code') {
          const items =
            source === 'code' && url.searchParams.get('q')?.startsWith('filename:plugin.json')
              ? [{ path: '.claude-plugin/plugin.json', repository }]
              : []
          return Response.json({ items, total_count: items.length, incomplete_results: false })
        }
        if (url.pathname === '/search/repositories')
          return Response.json({ items: [repository], total_count: 1, incomplete_results: false })
        if (url.pathname === '/repos/acme/reviewer') return Response.json(repository)
        if (url.pathname.endsWith('/marketplace.json')) return Response.json({}, { status: 404 })
        if (url.pathname.endsWith('/plugin.json'))
          return Response.json({ name: 'reviewer', description: 'Reviews code changes' }, { headers: { etag: '"plugin"' } })
        throw new Error(`Unexpected request ${url.pathname}`)
      }) as typeof fetch,
    })
    const result = await executeCrawl(db, reader, 'standalone', {
      dryRun: true,
      ranges: [[0, 10000]],
      repositorySearchEnabled: source === 'repository',
      now: () => new Date('2026-11-01T00:00:00Z'),
    })
    expect(result.status).toBe('draft')
    const records = PublishedReposArraySchema.parse(JSON.parse(readDraftSnapshot(db, 'standalone').reposJson))
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      owner: 'acme',
      repo_name: 'reviewer',
      plugins_count: 1,
      manifest_kind: 'standalone-plugin',
      plugins: [{ name: 'reviewer', description: 'Reviews code changes' }],
    })
    expect(paths.filter((path) => path.endsWith('/plugin.json'))).toHaveLength(1)
    await executeCrawl(db, reader, 'standalone-repeat', {
      dryRun: true,
      ranges: [[0, 10000]],
      repositorySearchEnabled: source === 'repository',
      now: () => new Date('2026-11-02T00:00:00Z'),
    })
    const repeated = PublishedReposArraySchema.parse(JSON.parse(readDraftSnapshot(db, 'standalone-repeat').reposJson))
    expect(repeated).toHaveLength(1)
    expect(repeated[0].id).toBe(records[0].id)
    expect(repeated[0].plugins_count).toBe(1)
  } finally {
    db.close()
  }
})
