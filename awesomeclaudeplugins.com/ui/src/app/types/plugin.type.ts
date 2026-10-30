import { isMarketplacePlugin, parseMarketplace as parseSharedMarketplace } from '@awesome-claude-plugins/catalog-contract'
import * as z from 'zod/mini'
import { getMcpBundleUrl } from '../../lib/mcpBundleUrl.ts'

const CONTROL_CHARACTER_PATTERN = /[\r\n]/
const GITHUB_REPO_PATH_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const PluginPathSchema = z.string().check(
  z.minLength(1),
  z.maxLength(512),
  z.refine((value) => value.trim().length > 0, { error: 'Must be a safe repository path' }),
  z.refine((value) => !(value.includes('..') || CONTROL_CHARACTER_PATTERN.test(value)), {
    error: 'Must be a safe repository path',
  })
)
const GitHubRepoPathSchema = z.string().check(z.regex(GITHUB_REPO_PATH_PATTERN, { error: 'Must be a GitHub repository path' }))
const PluginIdSchema = z.string().check(z.regex(/^[A-Za-z0-9._-]+$/, { error: 'Must be a safe plugin identifier' }))
const MarketplaceNameSchema = PluginIdSchema
const SourceRefSchema = z.string().check(
  z.minLength(1),
  z.maxLength(512),
  z.refine((value) => value.trim().length > 0, { error: 'Must be a safe source ref' }),
  z.refine((value) => !(value.includes('..') || CONTROL_CHARACTER_PATTERN.test(value)), {
    error: 'Must be a safe source ref',
  })
)
const SourceShaSchema = z.string().check(z.regex(/^[A-Fa-f0-9]{7,64}$/, { error: 'Must be a valid source commit' }))
const EmailSchema = z.string().check(
  z.maxLength(254),
  z.refine((value) => !CONTROL_CHARACTER_PATTERN.test(value), { error: 'Must be a safe author email' })
)
const SafeUrlSchema = (max: number) =>
  z.url().check(
    z.maxLength(max),
    z.refine(
      (value) => {
        try {
          const url = new URL(value)
          return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
        } catch {
          return false
        }
      },
      { error: 'Must be a safe HTTP(S) URL' }
    )
  )
const SourceUrlSchema = SafeUrlSchema(512)
const PluginSourceStringSchema = PluginPathSchema
const PluginComponentSchema = z.union([
  z.pipe(
    PluginPathSchema,
    z.transform((path) => [path])
  ),
  z.array(PluginPathSchema).check(z.maxLength(100)),
  z.record(z.string(), z.unknown()),
])

// An MCP component can also be an HTTPS bundle URL; mixed lists include inline server maps.
const McpLocationSchema = z.union([
  PluginPathSchema.check(
    z.refine((path) => !/^[a-z][a-z0-9+.-]*:/i.test(path), { error: 'MCP paths must be relative' })
  ),
  z.string().check(
    z.maxLength(512),
    z.refine((url) => getMcpBundleUrl(url) !== null, { error: 'Must be a safe HTTPS MCP bundle URL' })
  ),
])
const McpServersSchema = z.union([
  z.pipe(
    McpLocationSchema,
    z.transform((path) => [path])
  ),
  z.array(z.union([McpLocationSchema, z.record(z.string(), z.unknown())])).check(z.maxLength(100)),
  z.record(z.string(), z.unknown()),
])

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
  commands?: string | string[] | Record<string, unknown>
  agents?: string | string[] | Record<string, unknown>
  mcpServers?: string | Array<string | Record<string, unknown>> | Record<string, unknown>
  homepage?: string
  tags?: string[]
}

export type MarketplacePluginsResult = {
  plugins: Plugin[]
  invalidPluginCount: number
  issues: z.core.$ZodIssue[]
}

function hasComponentEntries(value: Plugin['commands'] | Plugin['mcpServers']): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  return Array.isArray(value) ? value.length > 0 : value !== undefined && Object.keys(value).length > 0
}

export const PluginSchema: z.ZodMiniType<Plugin> = z
  .object({
    name: z.optional(z.string().check(z.minLength(1), z.maxLength(160))),
    description: z.optional(z.string().check(z.maxLength(4_000))),
    version: z.optional(z.string().check(z.maxLength(100))),
    id: z.optional(PluginIdSchema),
    source: z.optional(
      z.union([
        PluginSourceStringSchema,
        z.object({
          source: PluginPathSchema,
          repo: z.optional(GitHubRepoPathSchema),
          url: z.optional(z.union([SourceUrlSchema, GitHubRepoPathSchema])),
          branch: z.optional(SourceRefSchema),
          path: z.optional(PluginPathSchema),
          ref: z.optional(SourceRefSchema),
          commit: z.optional(SourceShaSchema),
          sha: z.optional(SourceShaSchema),
        }),
      ])
    ),
    category: z.optional(z.string().check(z.maxLength(100))),
    author: z.optional(
      z.union([
        z.object({
          name: z.optional(z.string().check(z.maxLength(160))),
          email: z.optional(EmailSchema),
          url: z.optional(SafeUrlSchema(2_048)),
        }),
        z.pipe(
          z.string().check(z.minLength(1), z.maxLength(160)),
          z.transform((name) => ({ name }))
        ),
      ])
    ),
    license: z.optional(z.string().check(z.maxLength(160))),
    keywords: z.optional(z.array(z.string().check(z.minLength(1), z.maxLength(100))).check(z.maxLength(50))),
    strict: z.optional(z.boolean()),
    commands: z.optional(PluginComponentSchema),
    agents: z.optional(PluginComponentSchema),
    mcpServers: z.optional(McpServersSchema),
    homepage: z.optional(SafeUrlSchema(2_048)),
    tags: z.optional(z.array(z.string().check(z.minLength(1), z.maxLength(100))).check(z.maxLength(50))),
  })
  .check((context) => {
    const plugin = context.value
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
        hasComponentEntries(plugin.commands) ||
        hasComponentEntries(plugin.agents) ||
        hasComponentEntries(plugin.mcpServers)
      )
    ) {
      context.issues.push({
        code: 'custom',
        message: 'Manifest entry does not contain plugin metadata',
        input: plugin,
      })
    }
  })

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export const MarketplacePluginsSchema: z.ZodMiniType<MarketplacePluginsResult> = z.transform((value, context): MarketplacePluginsResult => {
  const result: MarketplacePluginsResult = { plugins: [], invalidPluginCount: 0, issues: [] }
  try {
    parseSharedMarketplace(value)
  } catch {
    context.issues.push({
      code: 'custom',
      message: 'Marketplace must have non-empty name, non-empty owner.name, and a plugins array',
      input: value,
    })
    return result
  }
  if (
    !isRecord(value) ||
    typeof value.name !== 'string' ||
    value.name.trim().length === 0 ||
    !isRecord(value.owner) ||
    typeof value.owner.name !== 'string' ||
    value.owner.name.length === 0 ||
    !Array.isArray(value.plugins)
  ) {
    context.issues.push({
      code: 'custom',
      message: 'Marketplace must have non-empty name, non-empty owner.name, and a plugins array',
      input: value,
    })
    return result
  }
  value.plugins.forEach((entry, index) => {
    const candidate = isRecord(entry)
      ? {
          ...entry,
          id: entry.name,
          name:
            typeof entry.displayName === 'string' && entry.displayName.trim().length > 0 && entry.displayName.length <= 160
              ? entry.displayName
              : entry.name,
        }
      : entry
    const parsed = PluginSchema.safeParse(candidate)
    if (parsed.success && isMarketplacePlugin(entry)) {
      result.plugins.push(parsed.data)
      return
    }
    if (!parsed.success && isMarketplacePlugin(entry)) {
      const core = PluginSchema.safeParse({ name: candidate.name, id: candidate.id, source: candidate.source })
      if (core.success) {
        result.plugins.push(core.data)
        return
      }
    }
    result.invalidPluginCount++
    if (!parsed.success) result.issues.push(...parsed.error.issues.map((issue) => ({ ...issue, path: ['plugins', index, ...issue.path] })))
  })
  return result
})

export function getMarketplaceName(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const object = value as Record<string, unknown>

  if (Array.isArray(object.plugins)) {
    const parsedName = MarketplaceNameSchema.safeParse(object.name)
    return parsedName.success ? parsedName.data : undefined
  }

  return undefined
}

/** Prefer the marketplace's own summary. A single plugin may represent a whole repository,
 * but a description picked from an arbitrary plugin in a multi-plugin catalog is misleading.
 */
export function getMarketplaceDescription(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined

  const clean = (candidate: unknown): string | undefined =>
    typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined
  const ownDescription = clean(value.description) ?? (isRecord(value.marketplace) ? clean(value.marketplace.description) : undefined)
  if (ownDescription) return ownDescription

  const entries = Array.isArray(value.plugins) ? value.plugins : [value]
  if (entries.length !== 1) return undefined
  const parsed = PluginSchema.safeParse(entries[0])
  return parsed.success ? clean(parsed.data.description) : undefined
}
