import { parseMarketplace, parseStandalonePlugin, type StandalonePluginManifest } from '@awesome-claude-plugins/catalog-contract'

export type RepositoryManifestLoadResult =
  | { kind: 'marketplace'; manifest: unknown; path: '.claude-plugin/marketplace.json' }
  | { kind: 'standalone-plugin'; manifest: StandalonePluginManifest; path: '.claude-plugin/plugin.json' }
  | { kind: 'missing' }
  | { kind: 'error'; path: string; reason: 'http' | 'invalid-content' | 'network'; status?: number }

export async function loadRepositoryManifest(fetchManifest: (path: string) => Promise<Response>): Promise<RepositoryManifestLoadResult> {
  for (const path of ['.claude-plugin/marketplace.json', '.claude-plugin/plugin.json'] as const) {
    let response: Response
    try {
      response = await fetchManifest(path)
    } catch {
      return { kind: 'error', path, reason: 'network' }
    }
    if (response.status === 404) continue
    if (!response.ok) return { kind: 'error', path, reason: 'http', status: response.status }
    let manifest: unknown
    try {
      manifest = await response.json()
    } catch (error) {
      return { kind: 'error', path, reason: error instanceof SyntaxError ? 'invalid-content' : 'network' }
    }
    try {
      if (path === '.claude-plugin/plugin.json') return { kind: 'standalone-plugin', manifest: parseStandalonePlugin(manifest), path }
      parseMarketplace(manifest)
      return { kind: 'marketplace', manifest, path }
    } catch {
      return { kind: 'error', path, reason: 'invalid-content' }
    }
  }
  return { kind: 'missing' }
}

/** Use the failed endpoint rather than the cached manifest kind when describing errors. */
export function repositoryManifestErrorMessage(result: Extract<RepositoryManifestLoadResult, { kind: 'error' }>): string {
  const label = result.path === '.claude-plugin/plugin.json' ? 'Plugin' : 'Marketplace'
  if (result.reason === 'invalid-content') return `${label} manifest contains invalid data.`
  if (result.status === 429)
    return `Failed to load ${label.toLowerCase()} manifest due to a request limit. Try again later or open the manifest file directly.`
  return `Failed to load ${label.toLowerCase()} manifest. Try again or open the manifest file directly.`
}
