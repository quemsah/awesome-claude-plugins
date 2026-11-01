import type { z } from 'zod'

export declare const GITHUB_REPO_PATH_PATTERN: RegExp
export declare const PLUGIN_ID_PATTERN: RegExp

export declare function isRecord(value: unknown): value is Record<string, unknown>
export declare function isSafePath(value: unknown): value is string
export declare function isSafeSourceUrl(value: unknown): boolean
export declare function isSafePluginId(value: unknown): value is string
export declare function resolveMarketplacePluginDisplayName(entry: unknown): string | undefined
export declare function isValidSource(value: unknown): boolean

export type MarketplacePluginIssue = {
  message: string
  path: Array<string | number>
}

export declare function getMarketplacePluginIssue(value: unknown): MarketplacePluginIssue | undefined
export declare function getMarketplacePluginRejection(value: unknown): string | undefined

export declare const MarketplaceRootSchema: z.ZodType<{ name: string; owner: { name: string }; plugins: unknown[] }>
export declare class MarketplaceFormatError extends Error {}
export declare function isMarketplacePlugin(value: unknown): value is Record<string, unknown> & { name: string; source: unknown }
export declare function parseMarketplace(value: unknown): { plugins: unknown[] }
