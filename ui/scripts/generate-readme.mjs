import { readFileSync, writeFileSync } from 'node:fs'

const repos = readJson('../src/data/repos.json')
const stats = readJson('../src/data/stats.json')
const checkOnly = process.argv.includes('--check')
const appUrl = 'https://awesomeclaudeplugins.com'
const outputPath = new URL('../../README.md', import.meta.url)
const generatedReadme = buildReadme()

if (checkOnly) {
  const currentReadme = readFileSync(outputPath, 'utf8')
  if (currentReadme !== generatedReadme) {
    console.error('README.md is out of date. Run `npm run readme:generate` from ui/.')
    process.exitCode = 1
  } else {
    console.log('README.md is up to date.')
  }
} else {
  writeFileSync(outputPath, generatedReadme)
  console.log('README.md generated.')
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'))
}

function buildReadme() {
  const sortedRepos = [...repos].sort((a, b) => {
    const starDelta = (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0)
    if (starDelta !== 0) return starDelta
    return (b.subscribers_count ?? 0) - (a.subscribers_count ?? 0)
  })

  const latestStats = stats.at(-1)
  const sourceSnapshot = latestStats?.date ?? 'unknown'
  const lastUpdated = latestStats ? formatDateUtc(new Date(latestStats.date)) : 'unknown'
  const repositoryCount = repos.length
  const pluginCount = repos.reduce((total, repo) => total + (repo.plugins_count || 0), 0)
  const tableRows = sortedRepos
    .slice(0, 100)
    .map(
      (repo, index) =>
        `| ${index + 1} | [${escapeMarkdown(repo.repo_name ?? 'Unknown')}](${repo.html_url}) | ${escapeTableCell(
          repo.description ?? ''
        )} | ${repo.stargazers_count ?? 0} | ${repo.subscribers_count ?? 0} | ${repo.plugins_count ?? 0} |`
    )
    .join('\n')

  return `# Awesome Claude Code Plugins: Top 100 Repositories

> Last updated: ${lastUpdated} with ${repositoryCount} total repositories indexed and ${pluginCount} plugins counted.

This README is generated from \`ui/src/data/repos.json\` and \`ui/src/data/stats.json\`.

Browse the live app at [awesomeclaudeplugins.com](${appUrl}).

## Project Links

- [Live app](${appUrl})
- [Contribution guide](CONTRIBUTING.md)
- [Data provenance](docs/data-provenance.md)
- [Catalog generation](docs/catalog-generation.md)

## Ranking Contract

- Ranking: repositories are sorted by GitHub stars descending, then subscribers descending as a tie-breaker.
- Repo Name: repository name linked to GitHub.
- Description: GitHub repository description at the time of the catalog snapshot.
- Stars: GitHub \`stargazers_count\`.
- Subs: GitHub \`subscribers_count\`.
- Plugins: cataloged plugin count for the repository; missing counts render as \`0\`.
- Last updated: UTC calendar date from the latest stats snapshot (\`${sourceSnapshot}\`).

## Maintenance

- Regenerate this file from \`ui/\` with \`npm run readme:generate\`.
- Check for drift from \`ui/\` with \`npm run readme:check\`.
- Catalog update review steps are documented in [docs/catalog-generation.md](docs/catalog-generation.md).
- Contribution and correction requests are documented in [CONTRIBUTING.md](CONTRIBUTING.md).

| # | Repo Name | Description | Stars | Subs | Plugins |
|---|-----------|-------------|-------|------|---------|
${tableRows}
`
}

function formatDateUtc(date) {
  const day = date.getUTCDate().toString().padStart(2, '0')
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0')
  const year = date.getUTCFullYear()
  return `${day}.${month}.${year} UTC`
}

function escapeMarkdown(value) {
  return String(value).replaceAll('|', '\\|')
}

function escapeTableCell(value) {
  return escapeMarkdown(value).replaceAll('\n', ' ').trim()
}
