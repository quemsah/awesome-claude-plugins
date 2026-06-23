export function getInstallCommand(pluginName?: string, pluginId?: string, repoPath?: string) {
  const normalizedName = pluginName?.toLowerCase().replace(/\s+/g, '-') || ''
  const suffix = pluginId ? `@${pluginId}` : repoPath ? `@${repoPath.replace('/', '-')}` : ''
  return `/plugin install ${normalizedName}${suffix}`
}
