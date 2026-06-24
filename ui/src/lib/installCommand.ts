/**
 * Install command types for Claude Code plugins.
 */
export type InstallCommandType = 'marketplace-add' | 'plugin-install'

export type PluginInstallCommandInput = {
  pluginName?: string
  pluginId?: string
  repoPath?: string
}

/**
 * Normalizes a plugin name for CLI usage.
 * Trims whitespace, lowercases, and collapses all whitespace sequences into hyphens.
 *
 * Examples:
 *   "  My   Plugin  " → "my-plugin"
 */
export function normalizePluginName(pluginName?: string): string {
  return pluginName?.trim().toLowerCase().replace(/\s+/g, '-') ?? ''
}

/**
 * Determines whether a plugin install command is verified.
 *
 * A command is considered verified when it contains at least one reliable identifier
 * from the manifest: a `pluginId` or a `repoPath`. These map directly to recognized
 * package references in Claude Code.
 *
 * A command composed only of a `pluginName` (with no `pluginId` or `repoPath`) is
 * unverified because the name alone may not resolve to an installed package.
 */
export function isPluginInstallCommandVerified(pluginId?: string, repoPath?: string): boolean {
  return Boolean(pluginId || repoPath)
}

/**
 * Generates a `/plugin install` command from verified manifest semantics.
 *
 * Priority:
 * 1. `pluginName` + `pluginId` → `/plugin install {name}@{id}`
 * 2. `pluginName` + `repoPath` → `/plugin install {name}@{repoPathWithHyphens}`
 * 3. `pluginId` only         → `/plugin install {id}`
 * 4. `pluginName` only       → `/plugin install {name}` (unverified)
 *
 * Returns `null` when no identifier is provided.
 */
export function getPluginInstallCommand({ pluginName, pluginId, repoPath }: PluginInstallCommandInput): string | null {
  const normalizedName = normalizePluginName(pluginName)
  const normalizedRepoPath = repoPath?.trim().replaceAll('/', '-')
  const normalizedPluginId = pluginId?.trim()

  if (normalizedName && normalizedPluginId) {
    return `/plugin install ${normalizedName}@${normalizedPluginId}`
  }

  if (normalizedName && normalizedRepoPath) {
    return `/plugin install ${normalizedName}@${normalizedRepoPath}`
  }

  if (normalizedPluginId) {
    return `/plugin install ${normalizedPluginId}`
  }

  if (normalizedName) {
    return `/plugin install ${normalizedName}`
  }

  return null
}

/**
 * Generates a `/plugin marketplace add` command from repository metadata.
 *
 * Verified when both `owner` and `repoName` are present.
 * Returns `null` when required data is missing.
 */
export function getMarketplaceAddCommand(owner?: string | null, repoName?: string | null): string | null {
  if (!(owner && repoName)) {
    return null
  }

  return `/plugin marketplace add ${owner}/${repoName}`
}
