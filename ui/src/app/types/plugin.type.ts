import { z } from 'zod'

const CONTROL_CHARACTER_PATTERN = /[\r\n]/
const PluginPathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !(value.includes('..') || CONTROL_CHARACTER_PATTERN.test(value)), 'Must be a safe repository path')
const GitHubRepoPathSchema = z.string().regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, 'Must be a GitHub repository path')
const PluginIdSchema = z.string().regex(/^[A-Za-z0-9._-]+$/, 'Must be a safe plugin identifier')

export type PluginAuthor = {
  name?: string
  email?: string
}

export type PluginSource = {
  source: string
  repo: string
  branch?: string
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
}

export const PluginSchema: z.ZodType<Plugin> = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(4_000).optional(),
  version: z.string().max(100).optional(),
  id: PluginIdSchema.optional(),
  source: z
    .union([
      PluginPathSchema,
      z.object({
        source: PluginPathSchema,
        repo: GitHubRepoPathSchema,
        branch: PluginPathSchema.optional(),
      }),
    ])
    .optional(),
  category: z.string().max(100).optional(),
  author: z.object({ name: z.string().max(160).optional(), email: z.string().email().max(254).optional() }).optional(),
  license: z.string().max(160).optional(),
  keywords: z.array(z.string().min(1).max(100)).max(50).optional(),
  strict: z.boolean().optional(),
  commands: z.array(PluginPathSchema).max(100).optional(),
  agents: z.array(PluginPathSchema).max(100).optional(),
  mcpServers: z.array(PluginPathSchema).max(100).optional(),
})

export const MarketplacePluginsSchema = z
  .union([z.array(PluginSchema), z.object({ plugins: z.array(PluginSchema) })])
  .transform((marketplace) => (Array.isArray(marketplace) ? marketplace : marketplace.plugins))
