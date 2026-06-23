const NUMBER_FORMAT = new Intl.NumberFormat('en-US')

export function getCatalogSummary(repos, stats) {
  const safeRepos = Array.isArray(repos) ? repos : []
  const safeStats = Array.isArray(stats) ? stats : []
  const latestStat = safeStats.at(-1)

  return {
    repoCount: safeRepos.length,
    pluginRepositoryCount: safeRepos.filter((repo) => Number.isFinite(repo.plugins_count) && repo.plugins_count > 0).length,
    pluginCount: safeRepos.reduce((total, repo) => total + (Number.isFinite(repo.plugins_count) ? repo.plugins_count : 0), 0),
    updatedAt: typeof latestStat?.date === 'string' && !Number.isNaN(Date.parse(latestStat.date)) ? latestStat.date : null,
  }
}

export function buildLlmsText(summary) {
  const updatedDate = summary.updatedAt ? new Date(summary.updatedAt).toISOString().split('T')[0] : 'unknown'

  return `# Awesome Claude Plugins

> A generated catalog of GitHub repositories related to Claude Code plugins, MCP servers, and agent skills.

This site helps users browse repository records, compare basic GitHub popularity signals, copy Claude plugin marketplace install commands, and inspect historical catalog growth.

## Current Catalog Snapshot

- Repositories indexed: ${formatNumber(summary.repoCount)}
- Repositories with plugin counts: ${formatNumber(summary.pluginRepositoryCount)}
- Plugin entries reported by catalog data: ${formatNumber(summary.pluginCount)}
- Last catalog update: ${updatedDate}

## Real Routes

- \`/\`: repository catalog with search, sorting, and load-more browsing.
- \`/stats\`: historical repository count charts based on checked-in snapshot data.
- \`/about\`: project purpose and automated discovery summary.
- \`/{owner}/{repo}\`: repository detail page for a catalog entry.
- \`/sitemap.xml\`: sitemap for crawlers.
- \`/manifest.webmanifest\`: web app manifest.
- \`/llms.txt\`: this machine-readable project summary.

## Implemented Capabilities

- Browse GitHub repository records from the generated catalog.
- Search the visible catalog by repository text.
- Sort repositories by stars, forks, and plugin count.
- Copy \`/plugin marketplace add owner/repo\` install commands from repository cards.
- View basic repository details and plugin entries when GitHub and raw repository data are available.
- View historical catalog-size statistics from checked-in snapshot data.

## Not Provided

- No public API is exposed by this app.
- No contribution form is implemented in the UI.
- No tutorials, integration guides, or curated editorial collections are implemented.
- No private quality endorsement is implied by catalog inclusion.

## Source

- GitHub repository: https://github.com/quemsah/awesome-claude-plugins`
}

function formatNumber(value) {
  return NUMBER_FORMAT.format(value)
}
