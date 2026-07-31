import type { Repo } from '../schemas/repo.schema.ts'
import { BASE_URL } from './constants.ts'
import { getMarketplaceAddCommand } from './installCommand.ts'
import { getGitHubRepoPath } from './repositoryIdentity.ts'

export function buildHomeMarkdown(): string {
  return `# Awesome Claude Plugins

A searchable catalog of GitHub repositories related to Claude Code plugins, MCP servers, and agent skills.

## Use the catalog

Search and sort the [repository catalog](${BASE_URL}/), or follow the [catalog browse pages](${BASE_URL}/browse/2) to explore every repository.

## More resources

- [Repository statistics](${BASE_URL}/stats)
- [About the catalog](${BASE_URL}/about)
- [Sitemap](${BASE_URL}/sitemap.xml)
`
}

export function buildAboutMarkdown(): string {
  return `# About Awesome Claude Plugins

Awesome Claude Plugins is a daily-updated directory of Claude Code plugins and tools, inspired by the "awesome" list movement.

Repositories are discovered from public GitHub data and refreshed daily. Plugin counts reflect marketplace manifests we can validate, not endorsements. Review code, licenses, and maintenance before installing.

## Explore

- [Repository catalog](${BASE_URL}/)
- [Repository statistics](${BASE_URL}/stats)
`
}

export function buildStatsMarkdown(): string {
  return `# Repository Statistics

The [statistics page](${BASE_URL}/stats) tracks the growth of repositories in the Awesome Claude Plugins catalog over time.

The data is generated from checked-in daily catalog snapshots.

## Explore

- [Repository catalog](${BASE_URL}/)
- [About the catalog](${BASE_URL}/about)
`
}

export function buildRepoMarkdown(repo: Repo): string {
  if (!(repo.owner && repo.repo_name)) {
    return ''
  }

  const repoPath = getGitHubRepoPath(repo.owner, repo.repo_name)
  const marketplaceCommand = getMarketplaceAddCommand(repo.owner, repo.repo_name)
  const pluginCount =
    repo.plugins_count === null ? 'No validated plugin count is available.' : `${repo.plugins_count} plugin entries are reported.`

  return `# ${repo.owner}/${repo.repo_name}

${repo.description?.trim() || 'No repository description is available.'}

## Repository

- [Catalog detail page](${BASE_URL}/${repoPath})
- [GitHub repository](${repo.html_url})
- Stars: ${repo.stargazers_count ?? 0}
- Forks: ${repo.forks_count ?? 0}
- ${pluginCount}

## Installation

${marketplaceCommand ? `When this repository exposes a Claude Code marketplace, add it with:\n\n\`\`\`bash\n${marketplaceCommand}\n\`\`\`` : 'No marketplace install command is available.'}
`
}
