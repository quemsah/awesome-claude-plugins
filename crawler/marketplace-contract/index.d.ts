export type PluginAuthor = {
  name?: string
  email?: string
  url?: string
}

export type PluginSource = {
  source: string
  repo?: string
  url?: string
  path?: string
  branch?: string
  ref?: string
  commit?: string
  sha?: string
}

export type Plugin = {
  name?: string
  description?: string
  version?: string
  id?: string
  source?: string | PluginSource
  category?: string
  author?: PluginAuthor
  license?: string
  keywords?: string[]
  strict?: boolean
  commands?: string[]
  agents?: string[]
  mcpServers?: string[]
  homepage?: string
  tags?: string[]
}

export type MarketplaceManifest = {
  name?: string
  plugins: Plugin[]
}

export type MarketplaceValidationIssue = {
  message: string
  path: Array<string | number>
}

export class MarketplaceValidationError extends Error {
  readonly issues: MarketplaceValidationIssue[]
  constructor(issues: MarketplaceValidationIssue[])
}

export type SafeParseResult<T> = { success: true; data: T } | { success: false; error: MarketplaceValidationError }

export function parsePluginManifest(value: unknown): Plugin
export function safeParsePluginManifest(value: unknown): SafeParseResult<Plugin>
export function getMarketplaceName(value: unknown): string | undefined
export function parseMarketplaceManifest(value: unknown): MarketplaceManifest
export function safeParseMarketplaceManifest(value: unknown): SafeParseResult<MarketplaceManifest>

export const PluginSchema: {
  safeParse(value: unknown): SafeParseResult<Plugin>
}

export const MarketplacePluginsSchema: {
  safeParse(value: unknown): SafeParseResult<Plugin[]>
}
