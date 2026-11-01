import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildRepoDetailsShards, buildSearchIndex } from './splitCatalog.js'

describe('splitCatalog', () => {
  const sampleRepos = [
    {
      id: 1,
      owner: 'ykdojo',
      repo_name: 'claude-code-tips',
      stargazers_count: 100,
      forks_count: 20,
      subscribers_count: 5,
      plugins_count: 1,
      plugins: [{ name: 'tip-runner', description: 'Runs tips' }],
      catalog_updated_at: '2026-10-31T23:26:43.901Z',
      pushed_at: '2026-09-25T03:50:54.000Z',
      catalog_added_at: '2026-04-30T11:51:08.784Z',
      license: 'MIT',
      archived: false,
      description: 'Useful tips for claude',
    },
    {
      id: 2,
      owner: 'archived-user',
      repo_name: 'old-repo',
      stargazers_count: 5,
      forks_count: 0,
      subscribers_count: 1,
      plugins_count: 0,
      plugins: [],
      catalog_updated_at: '2026-01-01T00:00:00.000Z',
      pushed_at: null,
      catalog_added_at: null,
      license: null,
      archived: true,
      description: null,
    },
  ]

  it('builds a compact search index with format v1 and expected rows', () => {
    const raw = buildSearchIndex(sampleRepos)
    const index = JSON.parse(raw)

    expect(index.format).toBe('v1')
    expect(index.fields).toContain('id')
    expect(index.fields).toContain('stars')
    expect(index.fields).toContain('description_quality')
    expect(index.rows).toHaveLength(2)
    expect(typeof index.search).toBe('string')

    const [row1, row2] = index.rows
    expect(row1[0]).toBe(1)
    expect(row1[1]).toBe('ykdojo')
    expect(row1[2]).toBe('claude-code-tips')
    expect(row1[3]).toBe(100)
    expect(row1[10]).toBe(1) // description_quality
    expect(row1[12]).toBe('Useful tips for claude')
    expect(row1[13]).toBeNull()

    expect(row2[0]).toBe(2)
    expect(row2[8]).toBe(true) // archived
    expect(row2[10]).toBe(0) // no desc
  })

  it('keeps the first canonical case alias and rejects different paths sharing an ID', () => {
    const samePath = { ...sampleRepos[0], owner: 'YKDOJO', repo_name: 'CLAUDE-CODE-TIPS', description: 'Wrong alias' }
    const shards = buildRepoDetailsShards([sampleRepos[0], samePath], 10)
    expect(JSON.parse(shards['1.json'])['1'].description).toBe('Useful tips for claude')
    expect(() => buildRepoDetailsShards([sampleRepos[0], { ...sampleRepos[0], owner: 'unrelated' }], 10)).toThrow(
      'Conflicting repository identity',
    )
  })

  it('fingerprints the exact canonical JSON bytes for stale-index detection', () => {
    const canonical = JSON.stringify(sampleRepos)
    const index = JSON.parse(buildSearchIndex(sampleRepos, canonical))
    expect(index.canonicalSha256).toBe(createHash('sha256').update(canonical).digest('hex'))
  })

  it('partitions repository details into shards by id', () => {
    const shards = buildRepoDetailsShards(sampleRepos, 10)
    expect(Object.keys(shards)).toHaveLength(10)

    const shard1 = JSON.parse(shards['1.json'])
    expect(shard1['1']).toBeDefined()
    expect(shard1['1'].description).toBe('Useful tips for claude')
    expect(shard1['1'].plugins).toHaveLength(1)
    expect(shard1['1'].subscribers_count).toBe(5)

    const shard2 = JSON.parse(shards['2.json'])
    expect(shard2['2']).toBeDefined()
    expect(shard2['2'].description).toBeNull()
  })
})
