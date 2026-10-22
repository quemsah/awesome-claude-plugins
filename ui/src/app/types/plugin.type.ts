import * as z from 'zod/mini'

const CONTROL_CHARACTER_PATTERN = /[\r\n]/
const GITHUB_REPO_PATH_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const PluginPathSchema = z.string().check(
  z.minLength(1),
  z.maxLength(512),
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

export type MarketplacePluginsResult = {
  plugins: Plugin[]
  invalidPluginCount: number
  issues: z.core.$ZodIssue[]
}

function hasComponentEntries(value: string[] | Record<string, unknown> | undefined): boolean {
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
    mcpServers: z.optional(PluginComponentSchema),
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

function isEmptyMarketplace(value: Record<string, unknown>): boolean {
  return Array.isArray(value.skills) || isRecord(value.skills)
}

export const MarketplacePluginsSchema: z.ZodMiniType<MarketplacePluginsResult> = z.transform((value, context): MarketplacePluginsResult => {
  const parsePluginList = (entries: unknown[], path: PropertyKey[] = []): MarketplacePluginsResult => {
    const result: MarketplacePluginsResult = { plugins: [], invalidPluginCount: 0, issues: [] }

    entries.forEach((entry, index) => {
      const parsed = PluginSchema.safeParse(entry)
      if (parsed.success) {
        result.plugins.push(parsed.data)
      } else {
        result.invalidPluginCount += 1
        result.issues.push(...parsed.error.issues.map((issue) => ({ ...issue, path: [...path, index, ...issue.path] })))
      }
    })

    return result
  }

  const emptyResult = (): MarketplacePluginsResult => ({ plugins: [], invalidPluginCount: 0, issues: [] })

  if (Array.isArray(value)) return parsePluginList(value)

  if (!isRecord(value)) {
    context.issues.push({ code: 'custom', message: 'Unsupported marketplace manifest shape', input: value })
    return emptyResult()
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
    if (parsedPlugin.success) return { plugins: [parsedPlugin.data], invalidPluginCount: 0, issues: [] }
    if (isEmptyMarketplace(value)) return emptyResult()

    for (const issue of parsedPlugin.error.issues) {
      context.issues.push({
        code: 'custom',
        message: issue.message,
        path: issue.path,
        input: value,
      })
    }
    return emptyResult()
  }

  if (isEmptyMarketplace(value)) return emptyResult()

  context.issues.push({ code: 'custom', message: 'Unsupported marketplace manifest shape', input: value })
  return emptyResult()
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

export function getMarketplaceDescription(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined

  let topLevelDesc: string | undefined
  if (!Array.isArray(value)) {
    const object = value as Record<string, unknown>
    if (typeof object.description === 'string' && object.description.trim().length > 0) {
      topLevelDesc = object.description.trim()
    } else if (
      isRecord(object.marketplace) &&
      typeof object.marketplace.description === 'string' &&
      object.marketplace.description.trim().length > 0
    ) {
      topLevelDesc = object.marketplace.description.trim()
    }
  }

  if (topLevelDesc && topLevelDesc.length >= 40) {
    return topLevelDesc
  }

  const parsed = MarketplacePluginsSchema.safeParse(value)
  if (parsed.success && parsed.data.length > 0) {
    const strongPlugin = parsed.data.find((plugin) => typeof plugin.description === 'string' && plugin.description.trim().length >= 40)
    if (strongPlugin?.description) {
      return strongPlugin.description.trim()
    }

    if (!topLevelDesc) {
      const anyPluginWithDesc = parsed.data.find((plugin) => typeof plugin.description === 'string' && plugin.description.trim().length > 0)
      if (anyPluginWithDesc?.description) {
        return anyPluginWithDesc.description.trim()
      }
    }
  }

  return topLevelDesc
}
