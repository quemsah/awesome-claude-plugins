import { NextResponse } from 'next/server'
import { getRateLimitKey, RateLimiter } from '../../../lib/rateLimit.ts'
import { toRouteTemplate } from '../../../lib/webVitalsPath.ts'

const MAX_REPORTS_PER_MINUTE = 30
const MAX_BODY_BYTES = 16_384
const MAX_FIELD_LENGTH = 128
const BLOCKED_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]{0,31}:?$/i
const TRAILING_SCHEME_COLON_PATTERN = /:$/
const rateLimiter = new RateLimiter(10_000, MAX_REPORTS_PER_MINUTE, 60_000)

type NormalizedReport = {
  blockedUri: unknown
  disposition: unknown
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
  const seen = new Set<string>()
  for (const report of reports) {
    const normalized = normalizeReport(report)
    if (!normalized) {
      continue
    }

    const document = getPathname(normalized.documentUri)
    const route = document === null ? null : toRouteTemplate(document)
    const directive = sanitize(normalized.violatedDirective)
    const disposition = normalizeDisposition(normalized.disposition)
    const blockedResource = classifyBlockedResource(normalized.blockedUri)
    const key = JSON.stringify([route, directive, disposition, blockedResource.kind, blockedResource.origin, blockedResource.scheme])
    if (seen.has(key)) {
      continue
    }
    seen.add(key)

    console.info(
      JSON.stringify({
        message: 'CSP violation report',
        level: disposition === 'report' ? 'info' : 'warn',
        event: 'csp_violation',
        route,
        directive,
        disposition,
        blockedKind: blockedResource.kind,
        blockedOrigin: blockedResource.origin,
        blockedScheme: blockedResource.scheme,
      })
    )
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
    return {
      documentUri: legacyReport['document-uri'],
      violatedDirective: legacyReport['violated-directive'],
      blockedUri: legacyReport['blocked-uri'],
      disposition: legacyReport.disposition,
    }
  }

  const reportBody = value.body
  if (isRecord(reportBody) && (value.type === undefined || value.type === 'csp-violation')) {
    return {
      documentUri: reportBody.documentURL,
      violatedDirective: reportBody.effectiveDirective,
      blockedUri: reportBody.blockedURL,
      disposition: reportBody.disposition,
    }
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function sanitize(value: unknown): string | null {
  return typeof value === 'string' ? value.replaceAll(/[\p{Cc}\p{Cf}]/gu, ' ').slice(0, MAX_FIELD_LENGTH) : null
}

function normalizeDisposition(value: unknown): 'enforce' | 'report' | null {
  return value === 'enforce' || value === 'report' ? value : null
}

function classifyBlockedResource(value: unknown): { kind: string | null; origin: string | null; scheme: string | null } {
  if (typeof value !== 'string' || !value.trim()) {
    return { kind: null, origin: null, scheme: null }
  }

  const blockedUri = value.trim()
  const schemeToken = BLOCKED_SCHEME_PATTERN.test(blockedUri) ? blockedUri.toLowerCase().replace(TRAILING_SCHEME_COLON_PATTERN, '') : null
  if (schemeToken === 'inline' || schemeToken === 'eval' || schemeToken === 'wasm-eval') {
    return { kind: schemeToken, origin: null, scheme: null }
  }
  if (schemeToken === 'data' || schemeToken === 'blob') {
    return { kind: schemeToken, origin: null, scheme: schemeToken }
  }
  if (schemeToken && ['chrome-extension', 'moz-extension', 'safari-web-extension', 'ms-browser-extension'].includes(schemeToken)) {
    return { kind: 'extension', origin: null, scheme: schemeToken }
  }
  if (schemeToken) {
    return { kind: 'scheme', origin: null, scheme: schemeToken }
  }

  try {
    const parsed = new URL(blockedUri)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return { kind: 'url', origin: parsed.origin, scheme: null }
    }
    if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') {
      return { kind: parsed.protocol.slice(0, -1), origin: null, scheme: parsed.protocol.slice(0, -1) }
    }
    if (['chrome-extension:', 'moz-extension:', 'safari-web-extension:', 'ms-browser-extension:'].includes(parsed.protocol)) {
      return { kind: 'extension', origin: null, scheme: parsed.protocol.slice(0, -1) }
    }
    return { kind: 'other', origin: null, scheme: parsed.protocol.slice(0, -1) || null }
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error
    }
  }

  return { kind: 'other', origin: null, scheme: null }
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
