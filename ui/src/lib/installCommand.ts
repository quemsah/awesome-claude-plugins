/**
 * Install command types for Claude Code plugins.
 */
export type InstallCommandType = 'marketplace-add' | 'plugin-install'

export type PluginInstallCommandInput = {
  pluginName?: string
  pluginId?: string
  repoPath?: string
}

const PLUGIN_COMMAND_TOKEN_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i

/**
 * Normalizes a plugin name for CLI usage.
 * Trims whitespace, lowercases, and collapses all whitespace sequences into hyphens.
 *
 * Examples:
 *   "  My   Plugin  " → "my-plugin"
 */
export function normalizePluginName(pluginName?: string): string {
  const normalized = typeof pluginName === 'string' ? pluginName.trim().toLowerCase().replace(/\s+/g, '-') : ''
  return PLUGIN_COMMAND_TOKEN_PATTERN.test(normalized) ? normalized : ''
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
export function isPluginInstallCommandVerified(pluginId?: string, _repoPath?: string): boolean {
  return Boolean(typeof pluginId === 'string' && pluginId.trim() && PLUGIN_COMMAND_TOKEN_PATTERN.test(pluginId))
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
  let normalizedName = normalizePluginName(pluginName)
  if (!(normalizedName || pluginId) && repoPath) {
    const lastPart = repoPath.split('/').filter(Boolean).pop()
    if (lastPart) {
      normalizedName = normalizePluginName(lastPart)
    }
  }
  const normalizedRepoPath = typeof repoPath === 'string' && repoPath.trim() ? repoPath.trim().replaceAll('/', '-') : undefined
  const normalizedPluginId = typeof pluginId === 'string' ? pluginId.trim() : undefined

  if (normalizedPluginId && !PLUGIN_COMMAND_TOKEN_PATTERN.test(normalizedPluginId)) {
    return null
  }
  if (normalizedRepoPath && !PLUGIN_COMMAND_TOKEN_PATTERN.test(normalizedRepoPath)) {
    return null
  }

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
  const trimmedOwner = typeof owner === 'string' ? owner.trim() || null : null
  const trimmedRepoName = typeof repoName === 'string' ? repoName.trim() || null : null

  if (
    !(
      trimmedOwner &&
      trimmedRepoName &&
      PLUGIN_COMMAND_TOKEN_PATTERN.test(trimmedOwner) &&
      PLUGIN_COMMAND_TOKEN_PATTERN.test(trimmedRepoName)
    )
  ) {
    return null
  }

  return `/plugin marketplace add ${trimmedOwner}/${trimmedRepoName}`
}
