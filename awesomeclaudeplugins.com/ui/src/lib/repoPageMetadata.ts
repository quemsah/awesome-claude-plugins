import { type CatalogRepo, extractPluginSummaries, getRepoCanonicalPath } from './catalog.ts'

const MINIMUM_MEANINGFUL_PLUGIN_DESCRIPTION_LENGTH = 40

function getVerifiedPluginDescription(repo: CatalogRepo): string | undefined {
  // Snapshot summaries can be truncated even when a marketplace has multiple plugins.
  if (repo.manifest_kind !== 'standalone-plugin' && repo.plugins_count !== 1) return undefined

  const plugins = extractPluginSummaries(repo)
  if (plugins?.length !== 1) return undefined

  const description = plugins[0]?.description?.trim()
  return description && description.length >= MINIMUM_MEANINGFUL_PLUGIN_DESCRIPTION_LENGTH ? description : undefined
}

/** Build stable detail-page and social metadata from one published catalog record. */
export function getRepoPageMetadata(repo: CatalogRepo): { description: string; title: string } {
  const repoPath = getRepoCanonicalPath(repo)
  const kindLabel = repo.manifest_kind === 'standalone-plugin' ? 'Standalone plugin' : repo.plugins_count === null ? null : 'Marketplace'
  const title = kindLabel ? `${repoPath} — ${kindLabel}` : repoPath
  const description =
    repo.description?.trim() || getVerifiedPluginDescription(repo) || `Explore ${repoPath} in the Awesome Claude Plugins directory.`

  return { description, title }
}
