import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route.ts'

const BASE_METRIC = { name: 'LCP', rating: 'good', value: 2_400 }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/vitals', () => {
  it('logs one structured info event with the route template', async () => {
    const info = mockInfo()
    const response = await post({ ...BASE_METRIC, navigationType: 'navigate', path: '/obra/superpowers', release: 'abc123' })

    expect(response.status).toBe(204)
    expect(info).toHaveBeenCalledTimes(1)

    const event = parseEvent(info)
    expect(event).toEqual({
      message: 'Web vital',
      level: 'info',
      event: 'web_vital',
      metric: 'LCP',
      navigationType: 'navigate',
      path: '/[owner]/[repo]',
      rating: 'good',
      release: 'abc123',
      value: 2_400,
    })
    expect(String(info.mock.calls[0]?.[0])).not.toContain('superpowers')
  })

  it('marks a non-good metric as a warning', async () => {
    const info = mockInfo()
    await post({ ...BASE_METRIC, rating: 'poor', path: '/stats' }, '198.51.100.7')

    expect(parseEvent(info)).toMatchObject({ level: 'warn', path: '/stats', rating: 'poor' })
  })

  it('collapses a forged path onto a known template', async () => {
    const info = mockInfo()
    await post({ ...BASE_METRIC, path: '/quemsah/private-notes/deep/secret' }, '198.51.100.8')

    expect(parseEvent(info)).toMatchObject({ path: 'other' })
  })

  it('logs a null path when the client omits it', async () => {
    const info = mockInfo()
    await post(BASE_METRIC, '198.51.100.9')

    expect(parseEvent(info)).toMatchObject({ path: null })
  })

  it('still rejects payloads with an unknown metric name', async () => {
    const info = mockInfo()
    const response = await post({ name: 'REFERRER', rating: 'good', value: 1, path: '/obra/superpowers' }, '198.51.100.10')

    expect(response.status).toBe(400)
    expect(info).not.toHaveBeenCalled()
  })
})

function mockInfo() {
  return vi.spyOn(console, 'info').mockImplementation(() => {})
}

function parseEvent(info: ReturnType<typeof mockInfo>) {
  return JSON.parse(String(info.mock.calls[0]?.[0])) as Record<string, unknown>
}

async function post(payload: Record<string, unknown>, clientIp = '198.51.100.1') {
  const request = new Request('http://localhost/api/vitals', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': clientIp },
    body: JSON.stringify(payload),
  })

  return POST(request)
}
