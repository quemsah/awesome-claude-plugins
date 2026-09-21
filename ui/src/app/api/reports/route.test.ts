import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/reports', () => {
  it('deduplicates repeated reports and logs a route template as one structured warning', async () => {
    const info = mockInfo()
    const report = {
      type: 'csp-violation',
      body: {
        documentURL: 'https://awesomeclaudeplugins.com/alexjx/skills',
        effectiveDirective: 'require-trusted-types-for',
      },
    }

    const response = await post([report, report, report])

    expect(response.status).toBe(204)
    expect(info).toHaveBeenCalledTimes(1)
    expect(parseEvent(info)).toEqual({
      message: 'CSP violation report',
      level: 'warn',
      event: 'csp_violation',
      route: '/[owner]/[repo]',
      directive: 'require-trusted-types-for',
    })
    expect(String(info.mock.calls[0]?.[0])).not.toContain('alexjx')
  })

  it('keeps distinct directives as distinct events', async () => {
    const info = mockInfo()
    await post(
      [
        {
          type: 'csp-violation',
          body: { documentURL: 'https://awesomeclaudeplugins.com/stats', effectiveDirective: 'script-src' },
        },
        {
          type: 'csp-violation',
          body: { documentURL: 'https://awesomeclaudeplugins.com/stats', effectiveDirective: 'style-src' },
        },
      ],
      '198.51.100.2'
    )

    expect(info).toHaveBeenCalledTimes(2)
  })
})

function mockInfo() {
  return vi.spyOn(console, 'info').mockImplementation(() => {})
}

function parseEvent(info: ReturnType<typeof mockInfo>) {
  return JSON.parse(String(info.mock.calls[0]?.[0])) as Record<string, unknown>
}

async function post(payload: unknown, clientIp = '198.51.100.1') {
  const request = new Request('http://localhost/api/reports', {
    method: 'POST',
    headers: { 'content-type': 'application/reports+json', 'x-forwarded-for': clientIp },
    body: JSON.stringify(payload),
  })

  return POST(request)
}
