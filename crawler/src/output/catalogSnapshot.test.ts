import { expect, it } from 'vitest'
import { openDatabase } from '../storage/db.js'
import { listPublishable } from '../storage/repositories.js'
import { renderRepos, renderStats } from './catalogSnapshot.js'
import { createStatsDraft } from './statsDraft.js'
import { validateSnapshot } from './validate.js'

it('renders only canonical, fully enriched repositories in original id and public key order', () => {
  const db = openDatabase(':memory:')
  try {
    const insert = db.prepare(`
      INSERT INTO repositories (id, html_url, stargazers_count, forks_count, subscribers_count,
        description, owner, owner_url, repo_name, plugins_count, repo_updated, createdAt, updatedAt)
      VALUES (@id, @html_url, @stargazers_count, @forks_count, @subscribers_count,
        @description, @owner, @owner_url, @repo_name, @plugins_count, @repo_updated, 'created', 'updated')
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
    }
    insert.run({ ...row, id: 39 })
    insert.run({
      ...row,
      id: 5,
      html_url: 'https://github.com/owner/Repo',
      owner: 'owner',
      owner_url: 'https://github.com/owner',
      description: null,
    })
    insert.run({ ...row, id: 1, html_url: null })
    insert.run({ ...row, id: 3, html_url: 'https://github.com/Owner/incomplete', repo_name: 'incomplete', stargazers_count: null })
    insert.run({ ...row, id: 4, html_url: 'https://github.com/Owner/Repo?secret=1' })
    insert.run({ ...row, id: 6, html_url: 'https://github.com/Owner/negative', repo_name: 'negative', forks_count: -1 })

    const result = renderRepos(db)
    expect(result.endsWith('\n')).toBe(true)
    expect(result).toBe(
      '[{"html_url":"https://github.com/owner/Repo","stargazers_count":3,"forks_count":0,"subscribers_count":2,"description":null,"owner":"owner","owner_url":"https://github.com/owner","repo_name":"Repo","plugins_count":null,"id":5},{"html_url":"https://github.com/Owner/Repo","stargazers_count":3,"forks_count":0,"subscribers_count":2,"description":"🍃 Привет","owner":"Owner","owner_url":"https://github.com/Owner","repo_name":"Repo","plugins_count":null,"id":39}]\n',
    )
    expect(JSON.parse(result)).toHaveLength(listPublishable(db).length)
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
    expect(() => validateSnapshot(renderRepos(db), rendered, { expectedSize: 1, requireLatestSize: true })).not.toThrow()
    expect(() => validateSnapshot(renderRepos(db), renderStats(db), { expectedSize: 1, requireLatestSize: true })).toThrow(
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
