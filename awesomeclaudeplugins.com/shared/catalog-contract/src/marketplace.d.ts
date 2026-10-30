import type { z } from 'zod'

export declare const MarketplaceRootSchema: z.ZodType<{ name: string; owner: { name: string }; plugins: unknown[] }>
export declare class MarketplaceFormatError extends Error {}
export declare function isMarketplacePlugin(value: unknown): value is Record<string, unknown> & { name: string; source: unknown }
export declare function parseMarketplace(value: unknown): { plugins: unknown[] }
