import { NextResponse } from 'next/server'
import { getRateLimitKey, RateLimiter } from '../../../lib/rateLimit.ts'

const MAX_REPORTS_PER_MINUTE = 30
const MAX_BODY_BYTES = 16_384
const MAX_FIELD_LENGTH = 128
const rateLimiter = new RateLimiter(10_000, MAX_REPORTS_PER_MINUTE, 60_000)

type NormalizedReport = {
  documentUri: unknown
  violatedDirective: unknown
}

export async function POST(request: Request) {
  if (rateLimiter.isRateLimited(getRateLimitKey(request.headers))) {
    return new NextResponse(null, { status: 429, headers: { 'Retry-After': '60' } })
  }

  const declaredLength = Number.parseInt(request.headers.get('content-length') ?? '', 10)
  if (Number.isSafeInteger(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 })
  }

  const body = await request.text()
  if (body.length > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 })
  }

  const payload = parseJson(body)
  const reports = Array.isArray(payload) ? payload : [payload]
  for (const report of reports) {
    const normalized = normalizeReport(report)
    if (!normalized) {
      continue
    }

    console.warn('CSP violation report', {
      document: getPathname(normalized.documentUri),
      directive: sanitize(normalized.violatedDirective),
    })
  }

  return new NextResponse(null, { status: 204 })
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null
    }
    throw error
  }
}

/**
 * Accepts both the legacy `report-uri` payload (`{ "csp-report": { ... } }`) and the Reporting API
 * payload (`[{ type: 'csp-violation', body: { documentURL, effectiveDirective } }]`) that
 * `Reporting-Endpoints` + `report-to` actually deliver.
 */
function normalizeReport(value: unknown): NormalizedReport | null {
  if (!isRecord(value)) {
    return null
  }

  const legacyReport = value['csp-report']
  if (isRecord(legacyReport)) {
    return { documentUri: legacyReport['document-uri'], violatedDirective: legacyReport['violated-directive'] }
  }

  const reportBody = value.body
  if (isRecord(reportBody) && (value.type === undefined || value.type === 'csp-violation')) {
    return { documentUri: reportBody.documentURL, violatedDirective: reportBody.effectiveDirective }
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function sanitize(value: unknown): string | null {
  return typeof value === 'string' ? value.replaceAll(/[\p{Cc}\p{Cf}]/gu, ' ').slice(0, MAX_FIELD_LENGTH) : null
}

function getPathname(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  try {
    return new URL(value).pathname.slice(0, MAX_FIELD_LENGTH)
  } catch (error) {
    if (error instanceof TypeError) {
      return null
    }
    throw error
  }
}
