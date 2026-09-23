const CONTROL_CHARACTER_PATTERN = /[\r\n]/
const GITHUB_REPO_PATH_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const PLUGIN_ID_PATTERN = /^[A-Za-z0-9._-]+$/
const SOURCE_SHA_PATTERN = /^[A-Fa-f0-9]{7,64}$/

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function issue(message, path = []) {
  throw new MarketplaceValidationError([{ message, path }])
}

function string(value, path, { min = 0, max, pattern, safePath = false, noControlCharacters = false } = {}) {
  if (typeof value !== 'string') issue('Expected a string', path)
  if (value.length < min) issue(`Expected at least ${min} character(s)`, path)
  if (max !== undefined && value.length > max) issue(`Expected at most ${max} character(s)`, path)
  if (pattern && !pattern.test(value)) issue('String does not match the required format', path)
  if (safePath && (value.includes('..') || CONTROL_CHARACTER_PATTERN.test(value))) issue('Must be a safe repository path', path)
  if (noControlCharacters && CONTROL_CHARACTER_PATTERN.test(value)) issue('Must not contain control characters', path)
  return value
}

function safeUrl(value, path, max) {
  const candidate = string(value, path, { max })
  try {
    const url = new URL(candidate)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) issue('Must be a safe HTTP(S) URL', path)
  } catch (error) {
    if (error instanceof MarketplaceValidationError) throw error
    issue('Must be a safe HTTP(S) URL', path)
  }
  return candidate
}

function stringArray(value, path, { maxItems, itemMax, safePath = false } = {}) {
  if (!Array.isArray(value)) issue('Expected an array', path)
  if (maxItems !== undefined && value.length > maxItems) issue(`Expected at most ${maxItems} item(s)`, path)
  return value.map((item, index) => string(item, [...path, index], { min: 1, max: itemMax, safePath }))
}

function assignParsed(target, source, key, path, parser) {
  if (source[key] === undefined) return
  const parsed = parser(source[key], [...path, key])
  if (parsed !== undefined) target[key] = parsed
}

function parseSourceUrl(value, path) {
  if (typeof value !== 'string') issue('Expected a string', path)
  return GITHUB_REPO_PATH_PATTERN.test(value) ? value : safeUrl(value, path, 512)
}

function parsePluginSource(value, path) {
  if (typeof value === 'string') return string(value, path, { min: 1, max: 512, safePath: true })
  if (!record(value)) issue('Expected a plugin source string or object', path)

  const parsed = {
    source: string(value.source, [...path, 'source'], { min: 1, max: 512, safePath: true }),
  }

  assignParsed(parsed, value, 'repo', path, (item, itemPath) => string(item, itemPath, { pattern: GITHUB_REPO_PATH_PATTERN }))
  assignParsed(parsed, value, 'url', path, parseSourceUrl)
  assignParsed(parsed, value, 'branch', path, (item, itemPath) => string(item, itemPath, { min: 1, max: 512, safePath: true }))
  assignParsed(parsed, value, 'ref', path, (item, itemPath) => string(item, itemPath, { min: 1, max: 512, safePath: true }))
  assignParsed(parsed, value, 'path', path, (item, itemPath) => string(item, itemPath, { min: 1, max: 512, safePath: true }))
  assignParsed(parsed, value, 'commit', path, (item, itemPath) => string(item, itemPath, { pattern: SOURCE_SHA_PATTERN }))
  assignParsed(parsed, value, 'sha', path, (item, itemPath) => string(item, itemPath, { pattern: SOURCE_SHA_PATTERN }))

  return parsed
}

function parseAuthor(value, path) {
  if (typeof value === 'string') return { name: string(value, path, { min: 1, max: 160 }) }
  if (!record(value)) issue('Expected an author string or object', path)

  const parsed = {}
  assignParsed(parsed, value, 'name', path, (item, itemPath) => string(item, itemPath, { max: 160 }))
  assignParsed(parsed, value, 'email', path, (item, itemPath) => string(item, itemPath, { max: 254, noControlCharacters: true }))
  assignParsed(parsed, value, 'url', path, (item, itemPath) => safeUrl(item, itemPath, 2048))
  return parsed
}

function parsePathListOrMap(value, path) {
  if (Array.isArray(value)) return stringArray(value, path, { maxItems: 100, itemMax: 512, safePath: true })
  if (record(value)) return undefined
  issue('Expected an array or object', path)
}

const PLUGIN_METADATA_KEYS = ['name', 'description', 'version', 'id', 'source', 'category', 'homepage', 'tags', 'commands', 'agents', 'mcpServers']

function parseBoolean(value, path) {
  if (typeof value !== 'boolean') issue('Expected a boolean', path)
  return value
}

function hasPluginMetadata(plugin) {
  return PLUGIN_METADATA_KEYS.some((key) => {
    const value = plugin[key]
    return Array.isArray(value) ? value.length > 0 : Boolean(value)
  })
}

function parsePlugin(value, path = []) {
  if (!record(value)) issue('Expected a plugin object', path)

  const plugin = {}
  assignParsed(plugin, value, 'name', path, (item, itemPath) => string(item, itemPath, { min: 1, max: 160 }))
  assignParsed(plugin, value, 'description', path, (item, itemPath) => string(item, itemPath, { max: 4000 }))
  assignParsed(plugin, value, 'version', path, (item, itemPath) => string(item, itemPath, { max: 100 }))
  assignParsed(plugin, value, 'id', path, (item, itemPath) => string(item, itemPath, { pattern: PLUGIN_ID_PATTERN }))
  assignParsed(plugin, value, 'source', path, parsePluginSource)
  assignParsed(plugin, value, 'category', path, (item, itemPath) => string(item, itemPath, { max: 100 }))
  assignParsed(plugin, value, 'author', path, parseAuthor)
  assignParsed(plugin, value, 'license', path, (item, itemPath) => string(item, itemPath, { max: 160 }))
  assignParsed(plugin, value, 'keywords', path, (item, itemPath) => stringArray(item, itemPath, { maxItems: 50, itemMax: 100 }))
  assignParsed(plugin, value, 'strict', path, parseBoolean)
  assignParsed(plugin, value, 'commands', path, parsePathListOrMap)
  assignParsed(plugin, value, 'agents', path, parsePathListOrMap)
  assignParsed(plugin, value, 'mcpServers', path, parsePathListOrMap)
  assignParsed(plugin, value, 'homepage', path, (item, itemPath) => safeUrl(item, itemPath, 2048))
  assignParsed(plugin, value, 'tags', path, (item, itemPath) => stringArray(item, itemPath, { maxItems: 50, itemMax: 100 }))

  if (!hasPluginMetadata(plugin)) issue('Manifest entry does not contain plugin metadata', path)
  return plugin
}

function parsePluginList(value, path) {
  if (!Array.isArray(value)) issue('Expected a plugin array', path)
  return value.map((plugin, index) => parsePlugin(plugin, [...path, index]))
}

function isEmptyMarketplace(value) {
  return record(value) && (Array.isArray(value.skills) || record(value.skills))
}

function marketplaceName(value) {
  return typeof value === 'string' && PLUGIN_ID_PATTERN.test(value) ? value : undefined
}

export class MarketplaceValidationError extends Error {
  constructor(issues) {
    super(issues[0]?.message ?? 'Invalid marketplace manifest')
    this.name = 'MarketplaceValidationError'
    this.issues = issues
  }
}

export function parsePluginManifest(value) {
  return parsePlugin(value)
}

export function safeParsePluginManifest(value) {
  try {
    return { success: true, data: parsePluginManifest(value) }
  } catch (error) {
    if (error instanceof MarketplaceValidationError) return { success: false, error }
    throw error
  }
}

export function getMarketplaceName(value) {
  if (!record(value)) return undefined
  if (Array.isArray(value.plugins)) return marketplaceName(value.name)
  if (!record(value.marketplace) || !Array.isArray(value.marketplace.plugins)) return undefined
  return marketplaceName(value.marketplace.name)
}

function wrappedMarketplacePlugins(value) {
  const candidates = [
    { container: value, key: 'plugins', path: ['plugins'] },
    { container: record(value.marketplace) ? value.marketplace : undefined, key: 'plugins', path: ['marketplace', 'plugins'] },
    { container: value, key: 'repositories', path: ['repositories'] },
  ]

  for (const { container, key, path } of candidates) {
    if (record(container) && Array.isArray(container[key])) return parsePluginList(container[key], path)
  }
  return undefined
}

function hasMarketplaceWrapper(value) {
  return ['plugins', 'repositories', 'marketplace'].some((key) => key in value)
}

function singleOrEmptyMarketplacePlugins(value) {
  try {
    return [parsePlugin(value)]
  } catch (error) {
    if (error instanceof MarketplaceValidationError && isEmptyMarketplace(value)) return []
    throw error
  }
}

function marketplacePlugins(value) {
  if (Array.isArray(value)) return parsePluginList(value, [])
  if (!record(value)) issue('Unsupported marketplace manifest shape')

  const wrapped = wrappedMarketplacePlugins(value)
  if (wrapped !== undefined) return wrapped
  if (!hasMarketplaceWrapper(value)) return singleOrEmptyMarketplacePlugins(value)
  if (isEmptyMarketplace(value)) return []
  issue('Unsupported marketplace manifest shape')
}

export function parseMarketplaceManifest(value) {
  const plugins = marketplacePlugins(value)
  const name = getMarketplaceName(value)
  return name === undefined ? { plugins } : { name, plugins }
}

export function safeParseMarketplaceManifest(value) {
  try {
    return { success: true, data: parseMarketplaceManifest(value) }
  } catch (error) {
    if (error instanceof MarketplaceValidationError) return { success: false, error }
    throw error
  }
}

export const PluginSchema = {
  safeParse: safeParsePluginManifest,
}

export const MarketplacePluginsSchema = {
  safeParse(value) {
    const parsed = safeParseMarketplaceManifest(value)
    if (!parsed.success) return parsed
    return { success: true, data: parsed.data.plugins }
  },
}
