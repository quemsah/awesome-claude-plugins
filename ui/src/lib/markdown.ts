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

const MISSING_DESCRIPTION = 'No repository description is available.'
const LINK_DESTINATION_PATTERN = /]\(/
const ATX_HEADING_PATTERN = /^#{1,6}(?= )/
const QUOTED_OR_LIST_PATTERN = /^(>|-|\+|\*)(?= )/
const ORDERED_LIST_PATTERN = /^(\d{1,9})([.)])(?= )/
const CODE_FENCE_PATTERN = /^(`{3,}|~{3,})/

/** YAML accepts JSON string syntax, so a quoted scalar keeps repository text inside its own property. */
function toYamlProperty(key: string, value: string | number | null): string {
  if (typeof value === 'number') {
    return `${key}: ${value}`
  }
  if (value === null) {
    return `${key}: null`
  }
  return `${key}: ${JSON.stringify(value)}`
}

/** A line break would open a new block in the body, while a quoted YAML scalar escapes it instead. */
function foldToSingleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Keeps untrusted repository text a paragraph: raw HTML would swallow `<placeholder>` tokens,
 * a link label would open a third-party link, and line-initial markers would rewrite the
 * outline of the generated document. Labels nest brackets, so one cannot escape only the outer one.
 */
function toMarkdownText(value: string): string {
  const withoutLinks = LINK_DESTINATION_PATTERN.test(value) ? value.replaceAll('[', '\\[') : value

  return withoutLinks
    .replaceAll('<', '\\<')
    .replace(ATX_HEADING_PATTERN, (marker) => `\\${marker}`)
    .replace(QUOTED_OR_LIST_PATTERN, (marker) => `\\${marker}`)
    .replace(ORDERED_LIST_PATTERN, (_match, digits: string, delimiter: string) => `${digits}\\${delimiter}`)
    .replace(CODE_FENCE_PATTERN, (fence) => `\\${fence}`)
}

export function buildRepoMarkdown(repo: Repo): string {
  if (!(repo.owner && repo.repo_name)) {
    return ''
  }

  const repoPath = getGitHubRepoPath(repo.owner, repo.repo_name)
  const canonicalUrl = `${BASE_URL}/${repoPath}`
  const marketplaceCommand = getMarketplaceAddCommand(repo.owner, repo.repo_name)
  const description = repo.description?.trim() || MISSING_DESCRIPTION
  const descriptionBody = toMarkdownText(foldToSingleLine(description))
  const pluginCount =
    repo.plugins_count === null ? 'No validated plugin count is available.' : `${repo.plugins_count} plugin entries are reported.`
  const quality = getCatalogQualityForRepo(repo)

  const frontmatter = [
    '---',
    toYamlProperty('title', `${repo.owner}/${repo.repo_name}`),
    toYamlProperty('description', description),
    toYamlProperty('canonical_url', canonicalUrl),
    toYamlProperty('repository_url', repo.html_url),
    toYamlProperty('stars', repo.stargazers_count ?? 0),
    toYamlProperty('forks', repo.forks_count ?? 0),
    toYamlProperty('plugins_count', repo.plugins_count),
    toYamlProperty('publication_state', quality.publicationState),
    toYamlProperty('quality_note', quality.qualityReason),
    toYamlProperty('catalog_updated', getCatalogLastModified().toISOString()),
    toYamlProperty('install_command', marketplaceCommand),
    '---',
  ].join('\n')

  return `${frontmatter}

# ${repo.owner}/${repo.repo_name}

${descriptionBody}

## Repository

- [Catalog detail page](${canonicalUrl})
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
