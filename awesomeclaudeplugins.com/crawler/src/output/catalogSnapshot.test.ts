import { expect, it } from 'vitest'
import { openDatabase } from '../storage/db.js'
import { listPublishable, updateEnriched, upsertDiscovery } from '../storage/repositories.js'
import { renderMarkdownPaths, renderRepos, renderStats } from './catalogSnapshot.js'
import { createStatsDraft } from './statsDraft.js'
import { validateSnapshot } from './validate.js'

it('renders only canonical, fully enriched repositories in original id and public key order', () => {
  const db = openDatabase(':memory:')
  try {
    const insert = db.prepare(`
      INSERT INTO repositories (id, html_url, stargazers_count, forks_count, subscribers_count,
        description, owner, owner_url, repo_name, plugins_count, repo_updated, catalog_updated_at, createdAt, updatedAt)
      VALUES (@id, @html_url, @stargazers_count, @forks_count, @subscribers_count,
        @description, @owner, @owner_url, @repo_name, @plugins_count, @repo_updated, @catalog_updated_at, 'created', 'updated')
    `)
    const row = {
      html_url: 'https://github.com/Owner/Repo',
      stargazers_count: 3,
      forks_count: 0,
      subscribers_count: 2,
      description: '🍃 Привет',
      owner: 'Owner',
      owner_url: 'https://github.com/Owner',
      repo_name: 'Repo',
      plugins_count: null,
      repo_updated: '2025-01-01T00:00:00Z',
      catalog_updated_at: '2025-02-03T04:05:06.789Z',
    }
    insert.run({ ...row, id: 39 })
    insert.run({
      ...row,
      id: 5,
      html_url: 'https://github.com/owner/Repo-two',
      owner: 'owner',
      owner_url: 'https://github.com/owner',
      repo_name: 'Repo-two',
      description: null,
    })
    insert.run({ ...row, id: 1, html_url: null })
    insert.run({ ...row, id: 3, html_url: 'https://github.com/Owner/incomplete', repo_name: 'incomplete', stargazers_count: null })
    insert.run({ ...row, id: 4, html_url: 'https://github.com/Owner/Repo?secret=1' })
    insert.run({ ...row, id: 6, html_url: 'https://github.com/Owner/negative', repo_name: 'negative', forks_count: -1 })

    const result = renderRepos(listPublishable(db))
    expect(result.endsWith('\n')).toBe(true)
    expect(result).toBe(
      `[
{"stargazers_count":3,"forks_count":0,"subscribers_count":2,"description":null,"owner":"owner","repo_name":"Repo-two","plugins_count":null,"catalog_updated_at":"2025-02-03T04:05:06.789Z","pushed_at":"2025-01-01T00:00:00.000Z","id":5},
{"stargazers_count":3,"forks_count":0,"subscribers_count":2,"description":"🍃 Привет","owner":"Owner","repo_name":"Repo","plugins_count":null,"catalog_updated_at":"2025-02-03T04:05:06.789Z","pushed_at":"2025-01-01T00:00:00.000Z","id":39}
]
`,
    )
    expect(JSON.parse(result)).toHaveLength(listPublishable(db).length)
  } finally {
    db.close()
  }
})

it('publishes validated plugin names and descriptions collected from manifests', () => {
  const db = openDatabase(':memory:')
  try {
    const id = upsertDiscovery(db, 'https://github.com/example/plugins', null)
    updateEnriched(db, id, {
      owner: 'example',
      repo_name: 'plugins',
      owner_url: 'https://github.com/example',
      description: null,
      repo_updated: null,
      stargazers_count: 3,
      forks_count: 1,
      subscribers_count: 0,
      plugins_count: 1,
      plugins_json: JSON.stringify([{ name: 'demo', description: 'Useful demonstration plugin' }]),
    })
    const snapshot = renderRepos(listPublishable(db))
    expect(JSON.parse(snapshot)[0].plugins).toEqual([{ name: 'demo', description: 'Useful demonstration plugin' }])
    const stats = '[{"id":1,"date":"2026-09-23T21:00:00.000Z","size":1}]'
    expect(() => validateSnapshot(snapshot, stats, { expectedSize: 1 })).not.toThrow()
  } finally {
    db.close()
  }
})
it('renders the markdown repository path sidecar from the publishable catalog', () => {
  const db = openDatabase(':memory:')
  try {
    const insert = db.prepare(`
      INSERT INTO repositories (id, html_url, stargazers_count, forks_count, subscribers_count,
        description, owner, owner_url, repo_name, plugins_count, createdAt, updatedAt)
      VALUES (@id, @html_url, 1, 0, 0, NULL, @owner, @owner_url, @repo_name, NULL, 'created', 'updated')
    `)
    insert.run({
      id: 1,
      html_url: 'https://github.com/zeta/spec.md',
      owner: 'zeta',
      owner_url: 'https://github.com/zeta',
      repo_name: 'spec.md',
    })
    insert.run({
      id: 2,
      html_url: 'https://github.com/Alpha/AGENTS.MD',
      owner: 'Alpha',
      owner_url: 'https://github.com/Alpha',
      repo_name: 'AGENTS.MD',
    })
    insert.run({
      id: 3,
      html_url: 'https://github.com/alpha/ordinary',
      owner: 'alpha',
      owner_url: 'https://github.com/alpha',
      repo_name: 'ordinary',
    })

    expect(renderMarkdownPaths(listPublishable(db))).toBe('["Alpha/AGENTS.MD","zeta/spec.md"]\n')
  } finally {
    db.close()
  }
})

it('renders historical stats by original id without including storage metadata or a draft', () => {
  const db = openDatabase(':memory:')
  try {
    db.prepare(`
      INSERT INTO stats (id, date, size, createdAt, updatedAt)
      VALUES (?, ?, ?, 'created', 'updated')
    `).run(7, '2026-01-02T00:00:00.000Z', 40958)
    db.prepare(`
      INSERT INTO stats (id, date, size, createdAt, updatedAt)
      VALUES (?, ?, ?, 'created', 'updated')
    `).run(2, '2026-01-01T00:00:00.000Z', 0)
    expect(renderStats(db)).toBe(
      '[{"id":2,"date":"2026-01-01T00:00:00.000Z","size":0},{"id":7,"date":"2026-01-02T00:00:00.000Z","size":40958}]\n',
    )
  } finally {
    db.close()
  }
})

it('renders exactly one draft after historical records without persisting it on dry runs', () => {
  const db = openDatabase(':memory:')
  try {
    db.prepare(`
      INSERT INTO stats (id, date, size, createdAt, updatedAt)
      VALUES (303, '2026-09-22T08:12:33.125Z', 42, 'created', 'updated')
    `).run()
    db.prepare(`
      INSERT INTO repositories (id, html_url, stargazers_count, forks_count, subscribers_count,
        description, owner, owner_url, repo_name, plugins_count, createdAt, updatedAt)
      VALUES (1, 'https://github.com/owner/repo', 4, 0, 2,
        NULL, 'owner', 'https://github.com/owner', 'repo', NULL, 'created', 'updated')
    `).run()
    const original = renderStats(db)
    const draft = createStatsDraft(JSON.parse(original), 1, new Date('2026-09-23T21:00:00.000Z'))
    const rendered = renderStats(db, draft)
    expect(rendered).toBe(
      '[{"id":303,"date":"2026-09-22T08:12:33.125Z","size":42},{"id":304,"date":"2026-09-23T21:00:00.000Z","size":1}]\n',
    )
    expect(renderStats(db, draft)).toBe(rendered)
    expect(renderStats(db)).toBe(original)
    expect(db.prepare('SELECT COUNT(*) AS total FROM stats').get()).toEqual({ total: 1 })
    expect(() => validateSnapshot(renderRepos(listPublishable(db)), rendered, { expectedSize: 1, requireLatestSize: true })).not.toThrow()
    expect(() => validateSnapshot(renderRepos(listPublishable(db)), renderStats(db), { expectedSize: 1, requireLatestSize: true })).toThrow(
      /stats\[0\]\.size/,
    )
  } finally {
    db.close()
  }
})

it('refuses to render the same draft twice after it has been persisted', () => {
  const db = openDatabase(':memory:')
  try {
    db.prepare(`
      INSERT INTO stats (id, date, size, createdAt, updatedAt)
      VALUES (304, '2026-09-23T21:00:00.000Z', 1, 'created', 'updated')
    `).run()
    expect(() => renderStats(db, { id: 304, date: '2026-09-23T21:00:00.000Z', size: 1 })).toThrow(/draft.*already|duplicate.*draft/i)
  } finally {
    db.close()
  }
})

it('rejects a draft with a different ID but an already-published timestamp before generating stats JSON', () => {
  const db = openDatabase(':memory:')
  try {
    db.prepare(`
      INSERT INTO stats (id, date, size, createdAt, updatedAt)
      VALUES (303, '2026-09-23T21:00:00.000Z', 1, 'created', 'updated')
    `).run()
    expect(() => renderStats(db, { id: 304, date: '2026-09-23T21:00:00.000Z', size: 2 })).toThrow(/draft.*date.*already|duplicate.*date/i)
    expect(JSON.parse(renderStats(db))).toEqual([{ id: 303, date: '2026-09-23T21:00:00.000Z', size: 1 }])
  } finally {
    db.close()
  }
})

it.each(['invalid', '2026-09-23T21:00:00+03:00', '2026-02-30T00:00:00.000Z'])(
  'rejects a draft date that is not canonical ISO UTC: %s',
  (date) => {
    const db = openDatabase(':memory:')
    try {
      expect(() => renderStats(db, { id: 304, date, size: 1 })).toThrow(/draft date.*ISO UTC/i)
    } finally {
      db.close()
    }
  },
)

it.each([-1, 1.5, Number.NaN])('rejects an invalid draft size before generating stats JSON: %s', (size) => {
  const db = openDatabase(':memory:')
  try {
    expect(() => renderStats(db, { id: 304, date: '2026-09-23T21:00:00.000Z', size })).toThrow(/draft size.*non-negative safe integer/i)
  } finally {
    db.close()
  }
})

it('publishes normalized GitHub freshness and first-seen date without changing legacy output', () => {
  const db = openDatabase(':memory:')
  try {
    const id = upsertDiscovery(db, 'https://github.com/demo/metadata', null, '2024-01-02T00:00:00.000Z')
    updateEnriched(db, id, {
      owner: 'demo',
      owner_url: 'https://github.com/demo',
      repo_name: 'metadata',
      description: 'Recent',
      stargazers_count: 1,
      forks_count: 0,
      subscribers_count: 0,
      plugins_count: 0,
      repo_updated: '2026-10-30T12:00:00Z',
      license: 'MIT',
      archived: 0,
    })
    const rows = listPublishable(db)
    const normal = JSON.parse(renderRepos(rows))[0]
    expect(normal).toMatchObject({
      pushed_at: '2026-10-30T12:00:00.000Z',
      catalog_added_at: '2024-01-02T00:00:00.000Z',
      license: 'MIT',
      archived: false,
    })
    const legacy = JSON.parse(renderRepos(rows, { legacyUrls: true }))[0]
    expect(legacy.pushed_at).toBeUndefined()
    expect(legacy.catalog_added_at).toBeUndefined()
    expect(legacy.license).toBeUndefined()
    const stats = '[{"id":1,"date":"2026-10-30T12:00:00.000Z","size":1}]'
    expect(() => validateSnapshot(renderRepos(rows), stats)).not.toThrow()
  } finally {
    db.close()
  }
})

it('omits malformed GitHub timestamps rather than interpreting them as midnight or normalized dates', () => {
  const db = openDatabase(':memory:')
  try {
    const id = upsertDiscovery(db, 'https://github.com/example/dates', null, '2026-10-30T10:30:00.000Z')
    updateEnriched(db, id, {
      owner: 'example',
      repo_name: 'dates',
      owner_url: 'https://github.com/example',
      description: null,
      stargazers_count: 1,
      forks_count: 0,
      subscribers_count: 0,
      plugins_count: 1,
      repo_updated: '2026-02-30T12:00:00Z',
    })
    const rows = listPublishable(db)
    expect(JSON.parse(renderRepos(rows))[0]).not.toHaveProperty('pushed_at')
    expect(JSON.parse(renderRepos(rows))[0]).toHaveProperty('catalog_added_at', '2026-10-30T10:30:00.000Z')
    for (const invalid of [
      '2026-10-30',
      '2026-02-30T12:00:00Z',
      '2025-02-29T12:00:00Z',
      '2026-13-01T00:00:00Z',
      '2026-01-01T25:00:00Z',
      '2026-01-01T12:60:00Z',
      '2026-01-01T12:00:60Z',
      '2026-01-01T12:00:00+24:00',
      '2026-01-01T12:00:00+02:60',
      '2026-01-01T12:00:00.1234Z',
      '2026-01-01 12:00:00Z',
    ]) {
      db.prepare('UPDATE repositories SET repo_updated = ? WHERE id = ?').run(invalid, id)
      expect(JSON.parse(renderRepos(listPublishable(db)))[0]).not.toHaveProperty('pushed_at')
    }
    db.prepare('UPDATE repositories SET repo_updated = ? WHERE id = ?').run('2026-10-30T13:15:00+03:00', id)
    expect(JSON.parse(renderRepos(listPublishable(db)))[0]).toHaveProperty('pushed_at', '2026-10-30T10:15:00.000Z')
    db.prepare('UPDATE repositories SET repo_updated = ? WHERE id = ?').run('2024-02-29T12:34:56.789+02:00', id)
    expect(JSON.parse(renderRepos(listPublishable(db)))[0]).toHaveProperty('pushed_at', '2024-02-29T10:34:56.789Z')
  } finally {
    db.close()
  }
})

it('preserves old published bytes with catalog_updated_at and plugins but no new metadata', () => {
  const db = openDatabase(':memory:')
  try {
    const id = upsertDiscovery(db, 'https://github.com/example/metadata', null, '2026-10-30T10:30:00.000Z')
    updateEnriched(db, id, {
      owner: 'example',
      repo_name: 'metadata',
      owner_url: 'https://github.com/example',
      description: null,
      stargazers_count: 1,
      forks_count: 0,
      subscribers_count: 0,
      plugins_count: 1,
      plugins_json: JSON.stringify([{ name: 'plugin' }]),
      repo_updated: '2026-10-30T10:00:00Z',
      license: 'MIT',
      archived: 1,
    })
    const old = JSON.parse(renderRepos(listPublishable(db), { includeNewCatalogMetadata: false }))[0]
    expect(old).toHaveProperty('plugins')
    expect(old).toHaveProperty('catalog_updated_at')
    for (const key of ['pushed_at', 'catalog_added_at', 'license', 'archived']) expect(old).not.toHaveProperty(key)
  } finally {
    db.close()
  }
})
