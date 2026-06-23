/** biome-ignore-all lint/style/useNamingConvention: Plugin manifests can include marketplace field names. */
import { z } from 'zod'

export const PluginAuthorSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
})

export const PluginSourceSchema = z.object({
  source: z.string(),
  repo: z.string(),
})

export const PluginSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  version: z.string().optional(),
  id: z.string().optional(),
  source: z.union([z.string(), PluginSourceSchema]).optional(),
  category: z.string().optional(),
  author: PluginAuthorSchema.optional(),
  license: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  strict: z.boolean().optional(),
  commands: z.array(z.string()).optional(),
  agents: z.array(z.string()).optional(),
  mcpServers: z.array(z.string()).optional(),
})

export const PluginManifestSchema = z.union([
  z.array(PluginSchema),
  z.object({
    plugins: z.array(PluginSchema),
  }),
])

export const IndexedPluginSchema = z.object({
  repo_path: z.string().min(1),
  manifest_url: z.string().url(),
  fetched_at: z.string().datetime(),
  validation_status: z.enum(['valid', 'invalid', 'unavailable']),
  validation_errors: z.array(z.string()),
  plugin: PluginSchema,
})

export const IndexedPluginsArraySchema = z.array(IndexedPluginSchema)

export type PluginAuthor = z.infer<typeof PluginAuthorSchema>
export type PluginSource = z.infer<typeof PluginSourceSchema>
export type Plugin = z.infer<typeof PluginSchema>
export type PluginManifest = z.infer<typeof PluginManifestSchema>
export type IndexedPlugin = z.infer<typeof IndexedPluginSchema>
