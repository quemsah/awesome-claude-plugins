import { parseGitHubRepositoryUrl } from '../github/identifiers.js'
import type { PublishableRepository } from '../storage/repositories.js'
import { tableCell } from './readme.js'
import { assertValidStatsDraft, type StatsRecord } from './statsDraft.js'

export function validateReadme(text: string, repositories: readonly PublishableRepository[], draft: StatsRecord): void {
  assertValidStatsDraft(draft)
  const date = new Date(draft.date)
  const day = String(date.getUTCDate()).padStart(2, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const lines = text.split('\n')
  if (
    draft.size !== repositories.length ||
    lines[0] !== '# Awesome Claude Code Plugins: Top 100 Repositories' ||
    lines[1] !== '' ||
    lines[2] !== `> Last updated: ${day}.${month}.${date.getUTCFullYear()} with ${draft.size} total repositories indexed.` ||
    lines[3] !== '' ||
    lines[4] !== '| # | Repo Name | Description | Stars | Subs | Plugins |' ||
    lines[5] !== '|---|-----------|-------------|-------|-------------|---------|' ||
    !text.endsWith('\n')
  ) {
    throw new Error('README snapshot has invalid header, date, or catalog size')
  }
  const ranked = [...repositories]
    .sort(
      (a, b) =>
        (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0) || (b.subscribers_count ?? 0) - (a.subscribers_count ?? 0) || a.id - b.id,
    )
    .slice(0, 100)
  const links = [...text.matchAll(/^\| (\d+) \| \[([^\]]+)\]\(([^)]+)\) \| /gm)]
  if (
    links.length !== ranked.length ||
    links.some((match, index) => {
      const repo = ranked[index]
      const url = match[3]
      return (
        repo === undefined ||
        url === undefined ||
        parseGitHubRepositoryUrl(url) === undefined ||
        match[1] !== String(index + 1) ||
        match[2] !== repo.repo_name ||
        url !== repo.html_url
      )
    })
  ) {
    throw new Error('README snapshot has incorrect top-100 links')
  }
  const rows = lines.slice(6, 6 + ranked.length)
  if (
    rows.some((line, index) => {
      const repo = ranked[index]
      return (
        repo === undefined ||
        line !==
        `| ${index + 1} | [${repo.repo_name}](${repo.html_url}) | ${tableCell(repo.description)} | ${repo.stargazers_count} | ${repo.subscribers_count ?? 0} | ${repo.plugins_count ?? 0} |`
      )
    })
  ) {
    throw new Error('README snapshot has incorrect top-100 rows')
  }
}
