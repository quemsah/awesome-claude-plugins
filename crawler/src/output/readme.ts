import type { PublishableRepository } from '../storage/repositories.js'
import { assertValidStatsDraft, type StatsRecord } from './statsDraft.js'

export function renderReadme(repositories: readonly PublishableRepository[], draft: StatsRecord): string {
  assertValidStatsDraft(draft)
  if (draft.size !== repositories.length) throw new Error('Draft catalog size must match public repositories')
  const date = new Date(draft.date)
  const day = String(date.getUTCDate()).padStart(2, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const year = date.getUTCFullYear()
  const lines = [
    '# Awesome Claude Code Plugins: Top 100 Repositories',
    '',
    `> Last updated: ${day}.${month}.${year} with ${draft.size} total repositories indexed.`,
    '',
    '| # | Repo Name | Description | Stars | Subs | Plugins |',
    '|---|-----------|-------------|-------|-------------|---------|',
  ]
  const ranked = [...repositories]
    .sort(
      (a, b) =>
        (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0) || (b.subscribers_count ?? 0) - (a.subscribers_count ?? 0) || a.id - b.id,
    )
    .slice(0, 100)
  ranked.forEach((repo, index) => {
    lines.push(
      `| ${index + 1} | [${repo.repo_name}](${repo.html_url}) | ${repo.description ?? ''} | ${repo.stargazers_count} | ${repo.subscribers_count ?? 0} | ${repo.plugins_count ?? 0} |`,
    )
  })
  return `${lines.join('\n')}\n`
}
