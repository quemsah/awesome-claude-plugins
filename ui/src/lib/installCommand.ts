export type PluginInstallCommandInput = {
  pluginName?: string
  pluginId?: string
  repoPath?: string
}

export function normalizePluginName(pluginName?: string): string {
  return pluginName?.trim().toLowerCase().replace(/\s+/g, '-') ?? ''
}

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

export function getMarketplaceAddCommand(owner?: string | null, repoName?: string | null): string | null {
  if (!(owner && repoName)) {
    return null
  }

  return `/plugin marketplace add ${owner}/${repoName}`
}
