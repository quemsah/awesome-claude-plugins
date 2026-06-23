import type { Repo } from '../schemas/repo.schema.ts'
import type { StatsItem } from '../schemas/stats.schema.ts'

export interface CatalogSummary {
  repoCount: number
  pluginRepositoryCount: number
  pluginCount: number
  updatedAt: string | null
}

export function getCatalogSummary(repos: Repo[], stats: StatsItem[]): CatalogSummary {
  const safeRepos: Array<Repo | null | undefined> = Array.isArray(repos) ? repos : []
  const safeStats = Array.isArray(stats) ? stats : []

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
    pluginRepositoryCount: safeRepos.filter((repo): repo is Repo => repo != null && Number.isFinite(repo.plugins_count)).length,
    pluginCount: safeRepos.reduce((total, repo) => {
      if (repo == null) return total
      const count = repo.plugins_count
      return total + (typeof count === 'number' && Number.isFinite(count) ? count : 0)
    }, 0),
    updatedAt: typeof latestDate === 'string' && !Number.isNaN(Date.parse(latestDate)) ? latestDate : null,
  }
}

export function buildLlmsText(summary: CatalogSummary): string {
  const updatedDate = summary.updatedAt ? new Date(summary.updatedAt).toISOString().split('T')[0] : 'unknown'

  return `# Awesome Claude Plugins

> A comprehensive directory of Claude AI plugins that helps developers discover, evaluate, and integrate high-quality plugins for their AI applications.

This website provides a curated collection of Claude plugins with advanced search capabilities, performance metrics, and seamless integration workflows to enhance AI development productivity. It also serves as a generated catalog of GitHub repositories related to Claude Code plugins, MCP servers, and agent skills.

## About This Website

- **Website Name**: Awesome Claude Plugins
- **Purpose**: Curated directory of Claude AI plugins and generated catalog of GitHub repositories related to Claude Code plugins, MCP servers, and agent skills
- **Target Audience**: AI developers, plugin creators, and Claude AI users
- **Unique Value**: Discover and integrate Claude plugins with performance analytics, curated recommendations, and automated GitHub repository discovery

## Current Catalog Snapshot

- Repositories indexed: ${formatPlainNumber(summary.repoCount)}
- Repositories with plugin counts: ${formatPlainNumber(summary.pluginRepositoryCount)}
- Plugin entries reported by catalog data: ${formatPlainNumber(summary.pluginCount)}
- Last catalog update: ${updatedDate}

## Website Features

- **Plugin Discovery**: Advanced search and filtering to find the perfect Claude plugins
- **Performance Analytics**: Detailed metrics and usage statistics for each plugin
- **Curated Collections**: Expertly selected plugins organized by category and use case
- **Seamless Integration**: One-click integration workflows and API access
- **Developer Resources**: Documentation, tutorials, and best practices for plugin development
- **Repository Catalog**: Browse GitHub repository records, compare popularity signals, and copy install commands

## Content Sections

- **Home Page**: Overview of featured plugins and search functionality
- **Plugin Directory**: Comprehensive listing of all available Claude plugins
- **Statistics Dashboard**: Performance metrics and usage trends
- **Documentation**: Guides and tutorials for plugin integration
- **About Section**: Information about the project and team
- **Stats Page**: Historical repository count charts based on checked-in snapshot data
- **Repository Detail**: \`/{owner}/{repo}\` pages for individual catalog entries

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

## Technical Implementation

- **Framework**: Next.js 16 with App Router for optimal performance
- **Styling**: Tailwind CSS with custom themes and responsive design
- **Animation**: CSS-based animations for enhanced user experience
- **Search**: Advanced search algorithms with real-time filtering
- **Analytics**: Performance tracking and usage statistics

## Usage Guidelines

- **Search**: Use the search bar to find plugins by name, category, or functionality
- **Filtering**: Apply filters to narrow down results based on specific criteria
- **Integration**: Follow the integration guides to add plugins to your applications
- **Contribution**: Submit new plugins through the contribution form

## Content Updates

This website is updated regularly with new plugins, performance data, and documentation. Major updates occur weekly, while minor updates may happen daily.

## Source

- **GitHub Repository**: https://github.com/quemsah/awesome-claude-plugins

## Optional Resources

- [Claude AI Documentation](https://www.anthropic.com/claude): Official Claude AI documentation
- [Next.js Official Docs](https://nextjs.org/docs): Framework documentation and best practices`
}

function formatPlainNumber(value: number): string {
  return String(value)
}
