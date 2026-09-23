import { isValidGitHubPathSegment } from '../github/identifiers.js'

type Issue = { path: string; message: string }
type SnapshotOptions = { expectedSize?: number; requireLatestSize?: boolean }

const repoKeys = [
  'html_url',
  'stargazers_count',
  'forks_count',
  'subscribers_count',
  'description',
  'owner',
  'owner_url',
  'repo_name',
  'plugins_count',
  'id',
] as const
const statsKeys = ['id', 'date', 'size'] as const
const utcDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function safePath(path: string): string {
  if (path === 'expectedSize') return path
  const prefix = /^(repos|stats)(?:\[\d+\])?/.exec(path)?.[0] ?? 'snapshot'
  const field = path.slice(prefix.length)
  const allowed = prefix.startsWith('repos') ? repoKeys : statsKeys
  return field.startsWith('.') && allowed.some((key) => field === `.${key}`) ? path : prefix
}

export class SnapshotValidationError extends Error {
  readonly count: number
  readonly paths: readonly string[]

  constructor(issues: Issue[]) {
    const examples = issues
      .slice(0, 20)
      .map(({ path, message }) => `${path}: ${message}`)
      .join('; ')
    super(`Snapshot validation failed (${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}): ${examples}`)
    this.name = 'SnapshotValidationError'
    this.count = issues.length
    this.paths = issues.slice(0, 20).map(({ path }) => safePath(path))
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function keys(value: Record<string, unknown>, expected: readonly string[], path: string, issues: Issue[]): void {
  for (const key of expected) {
    if (!(key in value)) issues.push({ path: `${path}.${key}`, message: 'required field is missing' })
  }
  for (const key of Object.keys(value)) {
    if (!expected.includes(key)) issues.push({ path: `${path}.${key}`, message: 'unexpected public field' })
  }
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function count(value: unknown, path: string, issues: Issue[], nullable = false): void {
  if (value === null && nullable) return
  if (!nonnegativeInteger(value)) issues.push({ path, message: 'must be a non-negative safe integer' })
}

function hasUnpairedSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) i++
      else return true
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return true
  }
  return false
}

function decode(value: string | Uint8Array, path: string, issues: Issue[]): unknown {
  let text: string
  try {
    if (typeof value === 'string') {
      if (hasUnpairedSurrogate(value)) throw new Error('unpaired surrogate')
      text = value
    } else {
      text = new TextDecoder('utf-8', { fatal: true }).decode(value)
    }
  } catch {
    issues.push({ path, message: 'invalid UTF-8' })
    return undefined
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    issues.push({ path, message: 'invalid JSON' })
    return undefined
  }
}

function validateRepoIdentity(item: Record<string, unknown>, path: string, issues: Issue[]): void {
  const { html_url: url, owner, owner_url: ownerUrl, repo_name: name } = item
  if (typeof owner !== 'string' || !isValidGitHubPathSegment(owner)) {
    issues.push({ path: `${path}.owner`, message: 'must be a GitHub owner segment' })
  }
  if (typeof name !== 'string' || !isValidGitHubPathSegment(name)) {
    issues.push({ path: `${path}.repo_name`, message: 'must be a GitHub repository segment' })
  }
  if (typeof url !== 'string' || (typeof owner === 'string' && typeof name === 'string' && url !== `https://github.com/${owner}/${name}`)) {
    issues.push({ path: `${path}.html_url`, message: 'must be the canonical GitHub repository URL' })
  }
  if (typeof ownerUrl !== 'string' || (typeof owner === 'string' && ownerUrl !== `https://github.com/${owner}`)) {
    issues.push({ path: `${path}.owner_url`, message: 'must be the canonical GitHub owner URL' })
  }
}

function validateRepoFields(item: Record<string, unknown>, path: string, issues: Issue[]): void {
  for (const key of ['stargazers_count', 'forks_count', 'subscribers_count', 'plugins_count'] as const) {
    count(item[key], `${path}.${key}`, issues, key === 'plugins_count')
  }
  if (item.description !== null && typeof item.description !== 'string') {
    issues.push({ path: `${path}.description`, message: 'must be a string or null' })
  }
  for (const key of ['description', 'owner', 'repo_name', 'html_url', 'owner_url'] as const) {
    if (typeof item[key] === 'string' && hasUnpairedSurrogate(item[key])) {
      issues.push({ path: `${path}.${key}`, message: 'invalid UTF-8 (unpaired surrogate)' })
    }
  }
}

function validateRepoItem(item: unknown, path: string, issues: Issue[], previousId: number): number {
  if (!record(item)) {
    issues.push({ path, message: 'must be an object' })
    return previousId
  }
  keys(item, repoKeys, path, issues)
  validateRepoIdentity(item, path, issues)
  validateRepoFields(item, path, issues)
  const id = item.id
  if (!nonnegativeInteger(id) || id === 0 || id <= previousId) {
    issues.push({ path: `${path}.id`, message: 'must be a positive unique id in ascending order' })
    return previousId
  }
  return id
}

function validateRepos(value: unknown, issues: Issue[]): number | undefined {
  if (!Array.isArray(value)) {
    if (value !== undefined) issues.push({ path: 'repos', message: 'must be an array' })
    return undefined
  }
  if (value.length === 0) issues.push({ path: 'repos', message: 'empty catalog; refusing to publish' })
  let previousId = 0
  for (const [index, item] of value.entries()) previousId = validateRepoItem(item, `repos[${index}]`, issues, previousId)
  return value.length
}

function validateStats(value: unknown, issues: Issue[]): number | undefined {
  if (!Array.isArray(value)) {
    if (value !== undefined) issues.push({ path: 'stats', message: 'must be an array' })
    return undefined
  }
  if (value.length === 0) issues.push({ path: 'stats', message: 'empty history; refusing to publish' })
  let previousId = 0
  for (const [index, item] of value.entries()) {
    const path = `stats[${index}]`
    if (!record(item)) {
      issues.push({ path, message: 'must be an object' })
      continue
    }
    keys(item, statsKeys, path, issues)
    if (!nonnegativeInteger(item.id) || item.id === 0 || item.id <= previousId) {
      issues.push({ path: `${path}.id`, message: 'must be a positive unique id in ascending order' })
    } else previousId = item.id
    const date = item.date
    if (typeof date !== 'string' || !utcDate.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString() !== date) {
      issues.push({ path: `${path}.date`, message: 'must be a valid ISO UTC timestamp' })
    }
    count(item.size, `${path}.size`, issues)
  }
  return value.length
}

/**
 * Validate both public files before publishing. Historical stats need not match the
 * current catalog until a new draft is appended; enable requireLatestSize for that draft.
 */
export function validateSnapshot(reposJson: string | Uint8Array, statsJson: string | Uint8Array, options: SnapshotOptions = {}): void {
  const issues: Issue[] = []
  const repos = decode(reposJson, 'repos', issues)
  const stats = decode(statsJson, 'stats', issues)
  const size = validateRepos(repos, issues)
  const statsLength = validateStats(stats, issues)
  if (options.expectedSize !== undefined) {
    if (!nonnegativeInteger(options.expectedSize)) {
      issues.push({ path: 'expectedSize', message: 'must be a non-negative safe integer' })
    } else if (size !== undefined && size !== options.expectedSize) {
      issues.push({ path: 'repos', message: `size ${size} differs from expected size ${options.expectedSize}` })
    }
  }
  if (options.requireLatestSize && size !== undefined && statsLength !== undefined && statsLength > 0) {
    const last = (stats as unknown[])[statsLength - 1]
    if (record(last) && last.size !== size) {
      issues.push({ path: `stats[${statsLength - 1}].size`, message: `must match repos size ${size}` })
    }
  }
  if (issues.length) {
    throw new SnapshotValidationError(issues)
  }
}
