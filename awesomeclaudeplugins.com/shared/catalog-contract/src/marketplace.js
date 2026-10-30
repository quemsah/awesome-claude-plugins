import { z } from 'zod'

const GITHUB_REPO_PATH_PATTERN = /^(?!\.{1,2}\/)[A-Za-z0-9._-]+\/(?!\.{1,2}$)[A-Za-z0-9._-]+$/

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isSafePath(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 512 && !value.includes('..') && !/[\r\n]/.test(value)
}

function isSafeSourceUrl(value) {
  if (typeof value !== 'string' || value.length > 512) return false
  if (GITHUB_REPO_PATH_PATTERN.test(value)) return true

  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
  } catch {
    return false
  }
}

function isValidSource(value) {
  if (isSafePath(value)) return true
  if (!isRecord(value) || !isSafePath(value.source)) return false

  return (
    (value.source !== 'github' || typeof value.repo === 'string') &&
    (value.source !== 'url' || typeof value.url === 'string') &&
    (value.repo === undefined || (typeof value.repo === 'string' && GITHUB_REPO_PATH_PATTERN.test(value.repo))) &&
    (value.url === undefined || isSafeSourceUrl(value.url)) &&
    (value.path === undefined || isSafePath(value.path)) &&
    (value.branch === undefined || isSafePath(value.branch)) &&
    (value.ref === undefined || isSafePath(value.ref)) &&
    (value.commit === undefined || (typeof value.commit === 'string' && /^[A-Fa-f0-9]{7,64}$/.test(value.commit))) &&
    (value.sha === undefined || (typeof value.sha === 'string' && /^[A-Fa-f0-9]{7,64}$/.test(value.sha)))
  )
}

export function isMarketplacePlugin(value) {
  return (
    isRecord(value) && typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 160 && isValidSource(value.source)
  )
}

export const MarketplaceRootSchema = z
  .object({
    name: z.string().trim().min(1),
    owner: z.object({ name: z.string().min(1) }).passthrough(),
    plugins: z.array(z.unknown()),
  })
  .passthrough()

export class MarketplaceFormatError extends Error {
  constructor() {
    super('Marketplace must have non-empty name, non-empty owner.name, and a plugins array')
    this.name = 'MarketplaceFormatError'
  }
}

export function parseMarketplace(value) {
  const result = MarketplaceRootSchema.safeParse(value)
  if (!result.success) throw new MarketplaceFormatError()
  return { plugins: result.data.plugins.filter(isMarketplacePlugin) }
}
