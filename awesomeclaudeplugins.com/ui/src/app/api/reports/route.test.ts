import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/reports', () => {
  it('deduplicates repeated reports and logs a route template as one structured warning', async () => {
    const info = mockInfo()
    const report = cspReport(
      'https://awesomeclaudeplugins.com/alexjx/skills',
      'require-trusted-types-for',
      'https://static.example.com/assets/script.js?token=secret'
    )

    const response = await post([report, report, report])

    expect(response.status).toBe(204)
    expect(info).toHaveBeenCalledTimes(1)
    expect(parseEvent(info)).toEqual({
      message: 'CSP violation report',
      level: 'warn',
      event: 'csp_violation',
      route: '/[owner]/[repo]',
      directive: 'require-trusted-types-for',
      disposition: 'enforce',
      blockedKind: 'url',
      blockedOrigin: 'https://static.example.com',
      blockedScheme: null,
    })
    expect(String(info.mock.calls[0]?.[0])).not.toContain('alexjx')
    expect(String(info.mock.calls[0]?.[0])).not.toContain('token=secret')
  })

  it('identifies browser extension reports without logging the extension id', async () => {
    const info = mockInfo()
    await post(cspReport('https://awesomeclaudeplugins.com/', 'script-src-elem', 'chrome-extension'))

    expect(parseEvent(info)).toMatchObject({ blockedKind: 'extension', blockedOrigin: null, blockedScheme: 'chrome-extension' })
  })

  it('classifies browser reports that contain only a non-HTTP scheme', async () => {
    const info = mockInfo()
    await post([
      cspReport('https://awesomeclaudeplugins.com/', 'img-src', 'data'),
      cspReport('https://awesomeclaudeplugins.com/', 'img-src', 'blob'),
      cspReport('https://awesomeclaudeplugins.com/', 'img-src', 'filesystem'),
    ])

    expect(info).toHaveBeenCalledTimes(3)
    expect(info.mock.calls.map(([entry]) => parseLogEntry(entry))).toEqual([
      expect.objectContaining({ blockedKind: 'data', blockedScheme: 'data' }),
      expect.objectContaining({ blockedKind: 'blob', blockedScheme: 'blob' }),
      expect.objectContaining({ blockedKind: 'scheme', blockedScheme: 'filesystem' }),
    ])
  })

  it('logs report-only policy violations as info', async () => {
    const info = mockInfo()
    await post(cspReport('https://awesomeclaudeplugins.com/', 'script-src', 'inline', 'report'))

    expect(parseEvent(info)).toMatchObject({ level: 'info', disposition: 'report' })
  })

  it('keeps distinct directives as distinct events', async () => {
    const info = mockInfo()
    await post(
      [cspReport('https://awesomeclaudeplugins.com/stats', 'script-src'), cspReport('https://awesomeclaudeplugins.com/stats', 'style-src')],
      '198.51.100.2'
    )

    expect(info).toHaveBeenCalledTimes(2)
  })
})

function cspReport(documentUrl: string, effectiveDirective: string, blockedUrl = 'inline', disposition: 'enforce' | 'report' = 'enforce') {
  return {
    type: 'csp-violation',
    body: {
      // biome-ignore lint/style/useNamingConvention: Reporting API uses the standard documentURL field name.
      documentURL: documentUrl,
      effectiveDirective,
      // biome-ignore lint/style/useNamingConvention: Reporting API uses the standard blockedURL field name.
      blockedURL: blockedUrl,
      disposition,
    },
  }
}

function mockInfo() {
  return vi.spyOn(console, 'info').mockImplementation(() => {})
}

function parseEvent(info: ReturnType<typeof mockInfo>) {
  return parseLogEntry(info.mock.calls[0]?.[0])
}

function parseLogEntry(entry: unknown) {
  return JSON.parse(String(entry)) as Record<string, unknown>
}

async function post(payload: unknown, clientIp = '198.51.100.1') {
  const request = new Request('http://localhost/api/reports', {
    method: 'POST',
    headers: { 'content-type': 'application/reports+json', 'x-forwarded-for': clientIp },
    body: JSON.stringify(payload),
  })

  return POST(request)
}
