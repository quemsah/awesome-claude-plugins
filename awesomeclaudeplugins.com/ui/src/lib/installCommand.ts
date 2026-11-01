import { isSafePluginId } from '@awesome-claude-plugins/catalog-contract'

/**
 * Install command types for Claude Code plugins.
 */
export type InstallCommandType = 'marketplace-add' | 'plugin-install'

export type PluginInstallCommandInput = {
  pluginName?: string
  pluginId?: string
  marketplaceName?: string
}

// CLI install identifiers are stricter than the catalog's safe display identifiers.
// See https://code.claude.com/docs/en/plugins/marketplace-reference
const INSTALL_TOKEN_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i
const REPOSITORY_COMMAND_TOKEN_PATTERN = INSTALL_TOKEN_PATTERN

function isInstallablePluginId(value: string): boolean {
  return isSafePluginId(value) && INSTALL_TOKEN_PATTERN.test(value)
}

function isInstallableMarketplaceName(value: string): boolean {
  return isInstallablePluginId(value) && !value.includes('..')
}

/**
 * Normalizes a plugin name for CLI usage.
 * Trims whitespace, lowercases, and collapses all whitespace sequences into hyphens.
 *
 * Examples:
 *   "  My   Plugin  " → "my-plugin"
 */
export function normalizePluginName(pluginName?: string): string {
  const normalized = typeof pluginName === 'string' ? pluginName.trim().toLowerCase().replace(/\s+/g, '-') : ''
  return isInstallablePluginId(normalized) ? normalized : ''
}

/**
 * Determines whether a plugin install command is verified.
 *
 * A marketplace-backed command is verified only when both names are valid.
 */
export function isPluginInstallCommandVerified(pluginName?: string, marketplaceName?: string): boolean {
  const normalizedPluginName = normalizePluginName(pluginName)
  const normalizedMarketplaceName = typeof marketplaceName === 'string' ? marketplaceName.trim() : ''

  return Boolean(normalizedPluginName && isInstallableMarketplaceName(normalizedMarketplaceName))
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
  if (normalizedPluginId && !isInstallablePluginId(normalizedPluginId)) return null
  const normalizedMarketplaceName = typeof marketplaceName === 'string' ? marketplaceName.trim() : undefined

  if (normalizedMarketplaceName && !isInstallableMarketplaceName(normalizedMarketplaceName)) {
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
      REPOSITORY_COMMAND_TOKEN_PATTERN.test(trimmedOwner) &&
      REPOSITORY_COMMAND_TOKEN_PATTERN.test(trimmedRepoName)
    )
  ) {
    return null
  }

  return `/plugin marketplace add ${trimmedOwner}/${trimmedRepoName}`
}
/**
 * Builds a one-step, in-session install command from a GitHub marketplace source.
 * Claude Code v2.1.275+ can register an unknown marketplace during this flow.
 * Never use display text or repository fields without token validation.
 */
export function getDirectPluginInstallCommand({
  pluginName,
  pluginId,
  marketplaceName,
  owner,
  repoName,
}: PluginInstallCommandInput & { owner?: string | null; repoName?: string | null }): string | null {
  if (marketplaceName !== undefined && !isInstallableMarketplaceName(marketplaceName)) return null
  const sourceCommand = getMarketplaceAddCommand(owner, repoName)
  const pluginCommand = getPluginInstallCommand({ pluginName, pluginId })
  if (!(sourceCommand && pluginCommand)) return null

  return `${pluginCommand} --marketplace ${sourceCommand.slice('/plugin marketplace add '.length)}`
}
