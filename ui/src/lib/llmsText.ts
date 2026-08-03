import type { Repo } from '../schemas/repo.schema.ts'
import type { StatsItem } from '../schemas/stats.schema.ts'
import { BASE_URL, SOURCE_REPOSITORY_URL } from './constants.ts'

export interface CatalogSummary {
  repoCount: number
  pluginRepositoryCount: number
  pluginCount: number
  updatedAt: string | null
}

export function getCatalogSummary(repos: Repo[], stats: StatsItem[]): CatalogSummary {
  const safeRepos = (Array.isArray(repos) ? repos : [])
    .filter((repo): repo is Repo => repo != null)
    .filter((repo): repo is Repo => repo.owner != null && repo.repo_name != null)
  const safeStats = (Array.isArray(stats) ? stats : []).filter((stat): stat is StatsItem => stat != null)

  let latestStat: StatsItem | undefined
  let latestDateValue: number = 0

  for (const stat of safeStats) {
    const parsed = Date.parse(stat.date)
    if (!Number.isNaN(parsed) && parsed > latestDateValue) {
      latestDateValue = parsed
      latestStat = stat
    }
  }

  const latestDate = latestStat?.date

  return {
    repoCount: safeRepos.length,
    pluginRepositoryCount: safeRepos.filter((repo): repo is Repo => Number.isFinite(repo.plugins_count)).length,
    pluginCount: safeRepos.reduce((total, repo) => {
      const count = repo.plugins_count
      return total + (typeof count === 'number' && Number.isFinite(count) ? count : 0)
    }, 0),
    updatedAt: typeof latestDate === 'string' && !Number.isNaN(Date.parse(latestDate)) ? latestDate : null,
  }
}

export function buildLlmsText(summary: CatalogSummary): string {
  const updatedDate = summary.updatedAt ? new Date(summary.updatedAt).toISOString().split('T')[0] : 'unknown'

  return `# Awesome Claude Plugins

> A searchable directory of GitHub repositories related to Claude Code plugins, MCP servers, and agent skills.

This website provides a generated catalog of GitHub repositories related to Claude Code plugins, MCP servers, and agent skills. Visitors can search and sort the catalog, inspect repository details, view historical catalog statistics, and copy available install commands.

## About This Website

- **Website Name**: Awesome Claude Plugins
- **Purpose**: Generated catalog of GitHub repositories related to Claude Code plugins, MCP servers, and agent skills
- **Target Audience**: AI developers, plugin creators, and Claude AI users
- **Unique Value**: Discover Claude-related repositories with repository metadata, plugin adoption counts, and historical catalog statistics

## Current Catalog Snapshot

- Repositories indexed: ${formatPlainNumber(summary.repoCount)}
- Repositories with plugin counts: ${formatPlainNumber(summary.pluginRepositoryCount)}
- Plugin entries reported by catalog data: ${formatPlainNumber(summary.pluginCount)}
- Last catalog update: ${updatedDate}

## Website Features

- **Plugin Discovery**: Search the catalog by repository text and sort results by stars, forks, or plugin count
- **Repository Details**: Open catalog entries to view repository metadata and any available plugin manifest entries
- **Statistics**: View historical repository-count snapshots
- **Install Commands**: Copy a marketplace install command when the catalog entry exposes a plugin repository
- **Repository Catalog**: Browse GitHub repository records and open their source repositories

## Primary Resources

- [Repository Catalog](${BASE_URL}/): Search and sort the catalog.
- [Catalog Browse Pages](${BASE_URL}/browse/2): Crawlable pagination for the full catalog.
- [Statistics](${BASE_URL}/stats): Historical repository-count charts.
- [About](${BASE_URL}/about): Project purpose and discovery workflow.
- [Sitemap](${BASE_URL}/sitemap.xml): All canonical repository URLs.
- [Catalog feed](${BASE_URL}/feed.json): Latest catalog snapshot.
- [Web App Manifest](${BASE_URL}/manifest.webmanifest): Installable-web-app metadata.
- [API Catalog](${BASE_URL}/.well-known/api-catalog): Machine-readable discovery links.
- [Security contact](${BASE_URL}/.well-known/security.txt): Where to report security issues.

## Content Formats

- [Home page Markdown](${BASE_URL}/index.md)
- [Statistics Markdown](${BASE_URL}/stats.md)
- [About Markdown](${BASE_URL}/about.md)
- Repository detail Markdown: \`${BASE_URL}/{owner}/{repo}.md\`

## Implemented Capabilities

- Browse GitHub repository records from the generated catalog.
- Search the visible catalog by repository text.
- Sort repositories by stars, forks, and plugin count.
- Copy \`/plugin marketplace add owner/repo\` install commands from repository cards.
- View basic repository details and plugin entries when GitHub and raw repository data are available.
- View historical catalog-size statistics from checked-in snapshot data.

## Technical Implementation

- **Framework**: Next.js 16 with App Router for optimal performance
- **Styling**: Tailwind CSS with custom themes and responsive design
- **Animation**: CSS-based animations for enhanced user experience
- **Search**: Repository-text search with sorting and load-more browsing
- **Analytics**: Historical repository-count snapshots

## Usage Guidelines

- **Search**: Use the search bar to find catalog entries by repository text
- **Sorting**: Sort results by stars, forks, or plugin count
- **Details**: Open a repository entry for metadata and available plugin information
- **Installation**: Copy the displayed marketplace install command when one is available

## Content Updates

The catalog and statistics are generated from checked-in snapshot data. Their update cadence depends on the repository discovery pipeline.

## Source

- **GitHub Repository**: ${SOURCE_REPOSITORY_URL}

## Optional Resources

- [Claude AI Documentation](https://www.anthropic.com/claude): Official Claude AI documentation
- [Next.js Official Docs](https://nextjs.org/docs): Framework documentation and best practices`
}

function formatPlainNumber(value: number): string {
  return String(value)
}
