import type Database from 'better-sqlite3'

export function populateFixture(db: Database.Database): void {
  const repo = db.prepare(`INSERT INTO repositories
    (id, html_url, stargazers_count, forks_count, subscribers_count, description, owner, owner_url, repo_name, repo_updated, plugins_count, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) `)
  const stamp = '2026-01-01T00:00:00.000Z'
  repo.run(
    1,
    'https://github.com/alpha/repo',
    0,
    2,
    3,
    'Quote "here", and\nanother line',
    'alpha',
    'https://github.com/alpha',
    'repo',
    stamp,
    0,
    stamp,
    stamp,
  )
  repo.run(3, 'https://github.com/123/project', 99, 0, 1, 'plain', '123', 'https://github.com/123', 'project', stamp, 5, stamp, stamp)
  repo.run(8, 'https://github.com/missing/owner', null, null, null, 'no owner', null, null, null, null, null, stamp, stamp)
  repo.run(10, null, null, null, null, null, null, null, null, null, null, stamp, stamp)
  repo.run(14, null, 2, 0, 0, 'orphan', null, null, null, null, 0, stamp, stamp)
  const stat = db.prepare('INSERT INTO stats (id, date, size, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)')
  stat.run(2, '2026-01-10T00:00:00.000Z', 0, stamp, stamp)
  stat.run(7, '2026-01-11T00:00:00.000Z', 3, stamp, stamp)
}
