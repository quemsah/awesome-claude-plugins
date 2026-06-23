import indexedPluginsData from '../data/plugins.json' with { type: 'json' }
import type { IndexedPlugin, Plugin } from '../schemas/plugin.schema.ts'
import { IndexedPluginsArraySchema, PluginManifestSchema } from '../schemas/plugin.schema.ts'

const parsedIndex = IndexedPluginsArraySchema.safeParse(indexedPluginsData)
const indexedPlugins = parsedIndex.success ? parsedIndex.data : []

export function getIndexedPluginsForRepo(repoPath: string): IndexedPlugin[] {
  return indexedPlugins.filter((entry) => entry.repo_path.toLowerCase() === repoPath.toLowerCase() && entry.validation_status === 'valid')
}

export function getIndexedPluginSearchText(entry: IndexedPlugin): string {
  const plugin = entry.plugin
  return [
    entry.repo_path,
    plugin.name,
    plugin.id,
    plugin.description,
    plugin.category,
    ...(plugin.keywords ?? []),
    ...(plugin.commands ?? []),
    ...(plugin.agents ?? []),
    ...(plugin.mcpServers ?? []),
  ]
    .filter(Boolean)
    .join(' ')
}

export function parsePluginManifest(data: unknown): { success: true; plugins: Plugin[] } | { success: false; error: string } {
  const result = PluginManifestSchema.safeParse(data)

  if (!result.success) {
    return {
      success: false,
      error: result.error.issues.map((issue) => issue.message).join('; '),
    }
  }

  return {
    success: true,
    plugins: Array.isArray(result.data) ? result.data : result.data.plugins,
  }
}
