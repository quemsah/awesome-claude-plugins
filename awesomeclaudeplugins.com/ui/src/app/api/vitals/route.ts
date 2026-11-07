import { NextResponse } from 'next/server'
import { getRateLimitKey, RateLimiter } from '../../../lib/rateLimit.ts'
import { toRouteTemplate } from '../../../lib/webVitalsPath.ts'

const MAX_REPORTS_PER_MINUTE = 30
const MAX_BODY_BYTES = 4_096
const MAX_RATING_LENGTH = 32
const MAX_CONTEXT_LENGTH = 128
const MAX_RESOURCE_ORIGIN_LENGTH = 256
const CONTROL_CHARACTER_PATTERN = /[\r\n]/
const ELEMENT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,31}$/
const rateLimiter = new RateLimiter(10_000, MAX_REPORTS_PER_MINUTE, 60_000)
const VALID_METRICS = new Set(['CLS', 'FCP', 'INP', 'LCP', 'TTFB'])
const VALID_RATINGS = new Set(['good', 'needs-improvement', 'poor'])

export async function POST(request: Request) {
  if (rateLimiter.isRateLimited(getRateLimitKey(request.headers))) {
    return new NextResponse(null, { status: 429, headers: { 'Retry-After': '60' } })
  }

  const declaredLength = Number.parseInt(request.headers.get('content-length') ?? '', 10)
  if (Number.isSafeInteger(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 })
  }

  const payload = await parsePayload(request)
  if (!isWebVital(payload)) {
    return new NextResponse(null, { status: 400 })
  }

  // Only the validated fields are logged so attacker-supplied keys never reach production logs.
  const rating = VALID_RATINGS.has(payload.rating) ? payload.rating : 'unknown'
  const lcpElementType = normalizeElementType(payload.lcpElementType)
  const lcpResourceOrigin = normalizeHttpOrigin(payload.lcpResourceOrigin)
  console.info(
    JSON.stringify({
      message: 'Web vital',
      level: rating === 'good' ? 'info' : 'warn',
      event: 'web_vital',
      metric: payload.name,
      navigationType: payload.navigationType ?? null,
      path: payload.path === undefined ? null : toRouteTemplate(payload.path),
      rating,
      release: payload.release ?? null,
      ...(payload.name === 'LCP' ? { lcpElementType, lcpResourceOrigin } : {}),
      value: payload.value,
    })
  )
  return new NextResponse(null, { status: 204 })
}

async function parsePayload(request: Request): Promise<unknown> {
  const body = await request.text()
  if (body.length > MAX_BODY_BYTES) {
    return null
  }

  try {
    return JSON.parse(body)
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null
    }
    throw error
  }
}

function isWebVital(value: unknown): value is {
  name: string
  navigationType?: string
  path?: string
  rating: string
  release?: string
  value: number
  lcpElementType?: unknown
  lcpResourceOrigin?: unknown
} {
  if (!(isRecord(value) && 'name' in value && 'rating' in value && 'value' in value)) {
    return false
  }

  return (
    typeof value.name === 'string' &&
    VALID_METRICS.has(value.name) &&
    typeof value.rating === 'string' &&
    value.rating.length <= MAX_RATING_LENGTH &&
    (value.navigationType === undefined || isContextString(value.navigationType)) &&
    (value.path === undefined || (isContextString(value.path) && value.path.startsWith('/'))) &&
    (value.release === undefined || isContextString(value.release)) &&
    typeof value.value === 'number' &&
    Number.isFinite(value.value)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isContextString(value: unknown, maxLength = MAX_CONTEXT_LENGTH): value is string {
  return typeof value === 'string' && value.length <= maxLength && !CONTROL_CHARACTER_PATTERN.test(value)
}

function normalizeElementType(value: unknown): string | null {
  return typeof value === 'string' && ELEMENT_NAME_PATTERN.test(value) ? value.toUpperCase() : null
}

function normalizeHttpOrigin(value: unknown): string | null {
  return isHttpOrigin(value) ? value : null
}

function isHttpOrigin(value: unknown): value is string {
  if (!isContextString(value, MAX_RESOURCE_ORIGIN_LENGTH)) return false

  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value
  } catch (error) {
    if (error instanceof TypeError) return false
    throw error
  }
}
