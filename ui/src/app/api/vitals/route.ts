import { NextResponse } from 'next/server'
import { getRateLimitKey, RateLimiter } from '../../../lib/rateLimit.ts'

const MAX_REPORTS_PER_MINUTE = 30
const MAX_BODY_BYTES = 4_096
const MAX_RATING_LENGTH = 32
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
  console.warn('Web vital', {
    name: payload.name,
    rating: VALID_RATINGS.has(payload.rating) ? payload.rating : 'unknown',
    value: payload.value,
  })
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

function isWebVital(value: unknown): value is { name: string; rating: string; value: number } {
  if (!value || typeof value !== 'object' || !('name' in value) || !('rating' in value) || !('value' in value)) {
    return false
  }

  return (
    typeof value.name === 'string' &&
    VALID_METRICS.has(value.name) &&
    typeof value.rating === 'string' &&
    value.rating.length <= MAX_RATING_LENGTH &&
    typeof value.value === 'number' &&
    Number.isFinite(value.value)
  )
}
