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

function optionalString(value, path, options) {
  return value === undefined ? undefined : string(value, path, options)
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

function optionalSafeUrl(value, path, max) {
  return value === undefined ? undefined : safeUrl(value, path, max)
}

function stringArray(value, path, { maxItems, itemMax, safePath = false } = {}) {
  if (!Array.isArray(value)) issue('Expected an array', path)
  if (maxItems !== undefined && value.length > maxItems) issue(`Expected at most ${maxItems} item(s)`, path)
  return value.map((item, index) => string(item, [...path, index], { min: 1, max: itemMax, safePath }))
}

function parsePluginSource(value, path) {
  if (typeof value === 'string') return string(value, path, { min: 1, max: 512, safePath: true })
  if (!record(value)) issue('Expected a plugin source string or object', path)

  const parsed = {
    source: string(value.source, [...path, 'source'], { min: 1, max: 512, safePath: true }),
  }

  const repo = optionalString(value.repo, [...path, 'repo'], { pattern: GITHUB_REPO_PATH_PATTERN })
  if (repo !== undefined) parsed.repo = repo

  if (value.url !== undefined) {
    if (typeof value.url !== 'string') issue('Expected a string', [...path, 'url'])
    if (GITHUB_REPO_PATH_PATTERN.test(value.url)) parsed.url = value.url
    else parsed.url = safeUrl(value.url, [...path, 'url'], 512)
  }

  for (const key of ['branch', 'ref']) {
    const parsedValue = optionalString(value[key], [...path, key], { min: 1, max: 512, safePath: true })
    if (parsedValue !== undefined) parsed[key] = parsedValue
  }

  const sourcePath = optionalString(value.path, [...path, 'path'], { min: 1, max: 512, safePath: true })
  if (sourcePath !== undefined) parsed.path = sourcePath

  for (const key of ['commit', 'sha']) {
    const parsedValue = optionalString(value[key], [...path, key], { pattern: SOURCE_SHA_PATTERN })
    if (parsedValue !== undefined) parsed[key] = parsedValue
  }

  return parsed
}

function parseAuthor(value, path) {
  if (typeof value === 'string') return { name: string(value, path, { min: 1, max: 160 }) }
  if (!record(value)) issue('Expected an author string or object', path)

  const parsed = {}
  const name = optionalString(value.name, [...path, 'name'], { max: 160 })
  if (name !== undefined) parsed.name = name
  const email = optionalString(value.email, [...path, 'email'], { max: 254, noControlCharacters: true })
  if (email !== undefined) parsed.email = email
  const url = optionalSafeUrl(value.url, [...path, 'url'], 2048)
  if (url !== undefined) parsed.url = url
  return parsed
}

function parsePathListOrMap(value, path) {
  if (Array.isArray(value)) return stringArray(value, path, { maxItems: 100, itemMax: 512, safePath: true })
  if (record(value)) return undefined
  issue('Expected an array or object', path)
}

function parsePlugin(value, path = []) {
  if (!record(value)) issue('Expected a plugin object', path)

  const plugin = {}
  const name = optionalString(value.name, [...path, 'name'], { min: 1, max: 160 })
  if (name !== undefined) plugin.name = name
  const description = optionalString(value.description, [...path, 'description'], { max: 4000 })
  if (description !== undefined) plugin.description = description
  const version = optionalString(value.version, [...path, 'version'], { max: 100 })
  if (version !== undefined) plugin.version = version
  const id = optionalString(value.id, [...path, 'id'], { pattern: PLUGIN_ID_PATTERN })
  if (id !== undefined) plugin.id = id
  if (value.source !== undefined) plugin.source = parsePluginSource(value.source, [...path, 'source'])
  const category = optionalString(value.category, [...path, 'category'], { max: 100 })
  if (category !== undefined) plugin.category = category
  if (value.author !== undefined) plugin.author = parseAuthor(value.author, [...path, 'author'])
  const license = optionalString(value.license, [...path, 'license'], { max: 160 })
  if (license !== undefined) plugin.license = license
  if (value.keywords !== undefined) plugin.keywords = stringArray(value.keywords, [...path, 'keywords'], { maxItems: 50, itemMax: 100 })
  if (value.strict !== undefined) {
    if (typeof value.strict !== 'boolean') issue('Expected a boolean', [...path, 'strict'])
    plugin.strict = value.strict
  }
  for (const key of ['commands', 'agents', 'mcpServers']) {
    if (value[key] !== undefined) {
      const parsed = parsePathListOrMap(value[key], [...path, key])
      if (parsed !== undefined) plugin[key] = parsed
    }
  }
  const homepage = optionalSafeUrl(value.homepage, [...path, 'homepage'], 2048)
  if (homepage !== undefined) plugin.homepage = homepage
  if (value.tags !== undefined) plugin.tags = stringArray(value.tags, [...path, 'tags'], { maxItems: 50, itemMax: 100 })

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
    issue('Manifest entry does not contain plugin metadata', path)
  }

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

export function parseMarketplaceManifest(value) {
  let plugins

  if (Array.isArray(value)) plugins = parsePluginList(value, [])
  else if (record(value) && Array.isArray(value.plugins)) plugins = parsePluginList(value.plugins, ['plugins'])
  else if (record(value) && record(value.marketplace) && Array.isArray(value.marketplace.plugins)) {
    plugins = parsePluginList(value.marketplace.plugins, ['marketplace', 'plugins'])
  } else if (record(value) && Array.isArray(value.repositories)) plugins = parsePluginList(value.repositories, ['repositories'])
  else if (record(value) && !('plugins' in value || 'repositories' in value || 'marketplace' in value)) {
    try {
      plugins = [parsePlugin(value)]
    } catch (error) {
      if (!(error instanceof MarketplaceValidationError) || !isEmptyMarketplace(value)) throw error
      plugins = []
    }
  } else if (isEmptyMarketplace(value)) plugins = []
  else issue('Unsupported marketplace manifest shape')

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
