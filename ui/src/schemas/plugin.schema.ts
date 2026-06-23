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

export type Plugin = z.infer<typeof PluginSchema>
export type PluginManifest = z.infer<typeof PluginManifestSchema>
