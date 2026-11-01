export type StandalonePluginManifest = Record<string, unknown> & { name: string }
export declare class StandalonePluginFormatError extends Error { constructor() }
export declare function parseStandalonePlugin(value: unknown): StandalonePluginManifest
export declare function toStandaloneCatalogManifest(manifest: StandalonePluginManifest): {
  manifestKind: 'standalone-plugin'
  plugins: Array<StandalonePluginManifest & { source: './' }>
}
