import type { Repo } from '../schemas/repo.schema.ts'
import { getCatalogLastModified, getCatalogQualityForRepo } from './catalog.ts'
import { BASE_URL, SOURCE_REPOSITORY_URL } from './constants.ts'
import { getMarketplaceAddCommand } from './installCommand.ts'
import { getGitHubRepoPath } from './repositoryIdentity.ts'
import { formatDate } from './utils.ts'

export function buildHomeMarkdown(): string {
  return `# Awesome Claude Plugins

A searchable catalog of GitHub repositories related to Claude Code plugins, MCP servers, and agent skills.

## Use the catalog

Search and sort the [repository catalog](${BASE_URL}/), or follow the [catalog browse pages](${BASE_URL}/browse/2) to explore every repository.

## Inclusion and quality

Entries are discovered from public GitHub data. Indexable entries have a repository description and a validated marketplace plugin count; entries missing those signals remain available for review but are not promoted in search engines. Stars, forks, and plugin counts are descriptive signals, not endorsements.

## Corrections and source

Report missing, duplicate, or inaccurate data in the [public source repository](${SOURCE_REPOSITORY_URL}/issues). Review source code, licenses, and maintenance before installing anything.

## More resources

- [Repository statistics](${BASE_URL}/stats)
- [About the catalog](${BASE_URL}/about)
- [Sitemap](${BASE_URL}/sitemap.xml)
`
}

export function buildAboutMarkdown(): string {
  return `# About Awesome Claude Plugins

Awesome Claude Plugins is a daily-updated directory of Claude Code plugins and tools, inspired by the "awesome" list movement.

Repositories are discovered from public GitHub data and refreshed daily. Indexable entries require a description and a validated marketplace plugin count. Plugin counts reflect manifests we can validate, not endorsements. Review code, licenses, and maintenance before installing.

## Provenance and corrections

Repository detail pages use current public GitHub metadata when available and show a labeled catalog snapshot during temporary outages. Report missing, duplicate, or inaccurate data in the [public source repository](${SOURCE_REPOSITORY_URL}/issues).

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
  const quality = getCatalogQualityForRepo(repo)

  return `# ${repo.owner}/${repo.repo_name}

${repo.description?.trim() || 'No repository description is available.'}

## Repository

- [Catalog detail page](${BASE_URL}/${repoPath})
- [GitHub repository](${repo.html_url})
- Stars: ${repo.stargazers_count ?? 0}
- Forks: ${repo.forks_count ?? 0}
- ${pluginCount}

## Catalog provenance

- Publication state: ${quality.publicationState}
- Quality note: ${quality.qualityReason}
- Catalog snapshot: ${formatDate(getCatalogLastModified())}
- Repository metadata source: public GitHub API when available

## Installation

${marketplaceCommand ? `When this repository exposes a Claude Code marketplace, add it with:\n\n\`\`\`bash\n${marketplaceCommand}\n\`\`\`` : 'No marketplace install command is available.'}
`
}
