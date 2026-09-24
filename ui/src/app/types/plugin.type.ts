import { z } from 'zod'

const CONTROL_CHARACTER_PATTERN = /[\r\n]/
const GITHUB_REPO_PATH_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const PluginPathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !(value.includes('..') || CONTROL_CHARACTER_PATTERN.test(value)), 'Must be a safe repository path')
const GitHubRepoPathSchema = z.string().regex(GITHUB_REPO_PATH_PATTERN, 'Must be a GitHub repository path')
const PluginIdSchema = z.string().regex(/^[A-Za-z0-9._-]+$/, 'Must be a safe plugin identifier')
const MarketplaceNameSchema = PluginIdSchema
const SourceRefSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !(value.includes('..') || CONTROL_CHARACTER_PATTERN.test(value)), 'Must be a safe source ref')
const SourceShaSchema = z.string().regex(/^[A-Fa-f0-9]{7,64}$/, 'Must be a valid source commit')
const EmailSchema = z
  .string()
  .max(254)
  .refine((value) => !CONTROL_CHARACTER_PATTERN.test(value), 'Must be a safe author email')
const SafeUrlSchema = (max: number) =>
  z
    .string()
    .max(max)
    .url()
    .refine((value) => {
      try {
        const url = new URL(value)
        return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
      } catch {
        return false
      }
    }, 'Must be a safe HTTP(S) URL')
const SourceUrlSchema = SafeUrlSchema(512)
const PluginSourceStringSchema = PluginPathSchema

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
  commands?: string[] | Record<string, unknown>
  agents?: string[] | Record<string, unknown>
  mcpServers?: string[] | Record<string, unknown>
  homepage?: string
  tags?: string[]
}

export const PluginSchema: z.ZodType<Plugin> = z
  .object({
    name: z.string().min(1).max(160).optional(),
    description: z.string().max(4_000).optional(),
    version: z.string().max(100).optional(),
    id: PluginIdSchema.optional(),
    source: z
      .union([
        PluginSourceStringSchema,
        z.object({
          source: PluginPathSchema,
          repo: GitHubRepoPathSchema.optional(),
          url: z.union([SourceUrlSchema, GitHubRepoPathSchema]).optional(),
          branch: SourceRefSchema.optional(),
          path: PluginPathSchema.optional(),
          ref: SourceRefSchema.optional(),
          commit: SourceShaSchema.optional(),
          sha: SourceShaSchema.optional(),
        }),
      ])
      .optional(),
    category: z.string().max(100).optional(),
    author: z
      .union([
        z.object({ name: z.string().max(160).optional(), email: EmailSchema.optional(), url: SafeUrlSchema(2_048).optional() }),
        z
          .string()
          .min(1)
          .max(160)
          .transform((name) => ({ name })),
      ])
      .optional(),
    license: z.string().max(160).optional(),
    keywords: z.array(z.string().min(1).max(100)).max(50).optional(),
    strict: z.boolean().optional(),
    commands: z.union([z.array(PluginPathSchema).max(100), z.record(z.string(), z.unknown()).transform(() => undefined)]).optional(),
    agents: z.union([z.array(PluginPathSchema).max(100), z.record(z.string(), z.unknown()).transform(() => undefined)]).optional(),
    mcpServers: z.union([z.array(PluginPathSchema).max(100), z.record(z.string(), z.unknown()).transform(() => undefined)]).optional(),
    homepage: SafeUrlSchema(2_048).optional(),
    tags: z.array(z.string().min(1).max(100)).max(50).optional(),
  })
  .superRefine((plugin, context) => {
    if (
      !(
        plugin.name ||
        plugin.description ||
        plugin.version ||
        plugin.id ||
        plugin.source ||
        plugin.category ||
        plugin.homepage ||
        plugin.tags?.length ||
        plugin.commands?.length ||
        plugin.agents?.length ||
        plugin.mcpServers?.length
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Manifest entry does not contain plugin metadata',
      })
    }
  })

const PluginListSchema = z.array(PluginSchema)

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isEmptyMarketplace(value: Record<string, unknown>): boolean {
  return Array.isArray(value.skills) || isRecord(value.skills)
}

export const MarketplacePluginsSchema = z.unknown().transform((value, context): Plugin[] => {
  const parsePluginList = (plugins: unknown, path: PropertyKey[] = []): Plugin[] => {
    const parsed = PluginListSchema.safeParse(plugins)
    if (parsed.success) return parsed.data

    for (const issue of parsed.error.issues) {
      context.addIssue({
        code: 'custom',
        message: issue.message,
        path: [...path, ...issue.path],
      })
    }
    return []
  }

  if (Array.isArray(value)) return parsePluginList(value)

  if (!isRecord(value)) {
    context.addIssue({ code: 'custom', message: 'Unsupported marketplace manifest shape' })
    return []
  }

  const candidates: {
    container: Record<string, unknown> | undefined
    key: 'plugins' | 'repositories'
    path: PropertyKey[]
  }[] = [
    { container: value, key: 'plugins', path: ['plugins'] },
    {
      container: isRecord(value.marketplace) ? value.marketplace : undefined,
      key: 'plugins',
      path: ['marketplace', 'plugins'],
    },
    { container: value, key: 'repositories', path: ['repositories'] },
  ]

  for (const { container, key, path } of candidates) {
    if (container && Array.isArray(container[key])) {
      return parsePluginList(container[key], path)
    }
  }

  const hasMarketplaceWrapper = ['plugins', 'repositories', 'marketplace'].some((key) => key in value)
  if (!hasMarketplaceWrapper) {
    const parsedPlugin = PluginSchema.safeParse(value)
    if (parsedPlugin.success) return [parsedPlugin.data]
    if (isEmptyMarketplace(value)) return []

    for (const issue of parsedPlugin.error.issues) {
      context.addIssue({
        code: 'custom',
        message: issue.message,
        path: issue.path,
      })
    }
    return []
  }

  if (isEmptyMarketplace(value)) return []

  context.addIssue({ code: 'custom', message: 'Unsupported marketplace manifest shape' })
  return []
})

export function getMarketplaceName(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const object = value as Record<string, unknown>

  if (Array.isArray(object.plugins)) {
    const parsedName = MarketplaceNameSchema.safeParse(object.name)
    return parsedName.success ? parsedName.data : undefined
  }

  if (!object.marketplace || typeof object.marketplace !== 'object' || Array.isArray(object.marketplace)) return undefined
  const marketplace = object.marketplace as Record<string, unknown>
  if (!Array.isArray(marketplace.plugins)) return undefined

  const parsedName = MarketplaceNameSchema.safeParse(marketplace.name)
  return parsedName.success ? parsedName.data : undefined
}
