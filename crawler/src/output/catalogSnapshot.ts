import type Database from 'better-sqlite3'
import { listPublishable } from '../storage/repositories.js'
import { assertValidStatsDraft, type StatsRecord } from './statsDraft.js'

export function renderRepos(db: Database.Database): string {
  const repositories = listPublishable(db).map((row) => ({
    html_url: row.html_url,
    stargazers_count: row.stargazers_count,
    forks_count: row.forks_count,
    subscribers_count: row.subscribers_count,
    description: row.description,
    owner: row.owner,
    owner_url: row.owner_url,
    repo_name: row.repo_name,
    plugins_count: row.plugins_count,
    id: row.id,
  }))
  return `${JSON.stringify(repositories)}\n`
}

export function renderStats(db: Database.Database, draft?: StatsRecord): string {
  const history = db.prepare('SELECT id, date, size FROM stats ORDER BY id').all() as StatsRecord[]
  if (draft) {
    assertValidStatsDraft(draft)
    if (history.some((record) => record.id >= draft.id)) throw new Error('Stats draft already present or older than history')
    if (history.some((record) => record.date === draft.date)) throw new Error('Stats draft date already present in history')
    history.push(draft)
  }
  return `${JSON.stringify(history)}\n`
}
