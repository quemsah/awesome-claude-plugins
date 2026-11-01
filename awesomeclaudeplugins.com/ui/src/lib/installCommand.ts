/**
 * Install command types for Claude Code plugins.
 */
export type InstallCommandType = 'marketplace-add' | 'plugin-install'

export type PluginInstallCommandInput = {
  pluginName?: string
  pluginId?: string
  marketplaceName?: string
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
 * A marketplace-backed command is verified only when both names are valid.
 */
export function isPluginInstallCommandVerified(pluginName?: string, marketplaceName?: string): boolean {
  const normalizedPluginName = normalizePluginName(pluginName)
  const normalizedMarketplaceName = typeof marketplaceName === 'string' ? marketplaceName.trim() : ''

  return Boolean(normalizedPluginName && normalizedMarketplaceName && PLUGIN_COMMAND_TOKEN_PATTERN.test(normalizedMarketplaceName))
}

/**
 * Generates a `/plugin install` command from verified manifest semantics.
 *
 * Priority:
 * 1. `pluginId` + `marketplaceName` → `/plugin install {pluginId}@{marketplaceName}`
 * 2. `pluginName` + `marketplaceName` → `/plugin install {name}@{marketplaceName}`
 * 3. `pluginId` only → `/plugin install {id}`
 * 4. `pluginName` only → `/plugin install {name}` (unverified)
 *
 * Returns `null` when the plugin name is invalid or the supplied marketplace name is unsafe.
 */
export function getPluginInstallCommand({ pluginName, pluginId, marketplaceName }: PluginInstallCommandInput): string | null {
  const normalizedName = normalizePluginName(pluginName)
  const normalizedPluginId = typeof pluginId === 'string' ? pluginId.trim() : undefined
  if (normalizedPluginId && !PLUGIN_COMMAND_TOKEN_PATTERN.test(normalizedPluginId)) return null
  const normalizedMarketplaceName = typeof marketplaceName === 'string' ? marketplaceName.trim() : undefined

  if (normalizedMarketplaceName && !PLUGIN_COMMAND_TOKEN_PATTERN.test(normalizedMarketplaceName)) {
    return null
  }

  const installName = normalizedPluginId || normalizedName
  if (installName && normalizedMarketplaceName) {
    return `/plugin install ${installName}@${normalizedMarketplaceName}`
  }

  if (installName) {
    return `/plugin install ${installName}`
  }

  return null
}

/**
 * Generates a `/plugin marketplace add` command from repository metadata.
 *
 * Verified when both `owner` and `repoName` are present (or passed as "owner/repo").
 * Returns `null` when required data is missing or invalid.
 */
export function getMarketplaceAddCommand(owner?: string | null, repoName?: string | null): string | null {
  let trimmedOwner = typeof owner === 'string' ? owner.trim() || null : null
  let trimmedRepoName = typeof repoName === 'string' ? repoName.trim() || null : null

  if (trimmedOwner && !trimmedRepoName && trimmedOwner.includes('/')) {
    const parts = trimmedOwner.split('/')
    if (parts.length === 2) {
      trimmedOwner = parts[0]?.trim() || null
      trimmedRepoName = parts[1]?.trim() || null
    }
  }

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

export type OfficialMarketplaceInput = {
  owner?: string | null
  repoName?: string | null
  marketplaceName?: string | null
  repoPath?: string | null
}

/**
 * Determines whether a marketplace is the official Anthropic marketplace.
 * The official Anthropic marketplace is pre-configured in Claude Code CLI,
 * so users do not need to run `/plugin marketplace add` before installing.
 *
 * Official marketplaces must be owned by the Anthropic GitHub organization
 * ('anthropics' or 'anthropic').
 */
export function isOfficialMarketplace(input?: OfficialMarketplaceInput | null): boolean {
  if (!input) return false

  let owner = typeof input.owner === 'string' ? input.owner.trim().toLowerCase() : ''
  const repoName = typeof input.repoName === 'string' ? input.repoName.trim().toLowerCase() : ''

  if (!(owner || repoName) && typeof input.repoPath === 'string') {
    const parts = input.repoPath.split('/')
    if (parts.length === 2) {
      owner = parts[0]?.trim().toLowerCase() ?? ''
    }
  }

  // Official Anthropic GitHub organizations
  return owner === 'anthropics' || owner === 'anthropic'
}

/**
 * Combines the marketplace add command and plugin install command.
 *
 * When both commands are available, joins them using the specified delimiter (default: "\n" for Claude Code CLI prompts).
 * Returns a single command string, or null if neither command is valid.
 */
export function getCombinedInstallCommand(
  marketplaceAddCommand?: string | null,
  pluginInstallCommand?: string | null,
  delimiter: '\n' | ' && ' = '\n'
): string | null {
  const trimmedAdd = typeof marketplaceAddCommand === 'string' ? marketplaceAddCommand.trim() || null : null
  const trimmedInstall = typeof pluginInstallCommand === 'string' ? pluginInstallCommand.trim() || null : null

  if (trimmedAdd && trimmedInstall) {
    return `${trimmedAdd}${delimiter}${trimmedInstall}`
  }

  return trimmedInstall ?? trimmedAdd ?? null
}
