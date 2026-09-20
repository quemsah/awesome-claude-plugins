import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route.ts'

const BASE_METRIC = { name: 'LCP', rating: 'good', value: 2_400 }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/vitals', () => {
  it('logs the route template instead of the repository the visitor opened', async () => {
    const warn = mockWarn()
    const response = await post({ ...BASE_METRIC, navigationType: 'navigate', path: '/obra/superpowers' })

    expect(response.status).toBe(204)
    expect(warn).toHaveBeenCalledWith('Web vital', expect.objectContaining({ path: '/[owner]/[repo]' }))
    expect(JSON.stringify(warn.mock.calls)).not.toContain('superpowers')
  })

  it('collapses a forged path onto a known template', async () => {
    const warn = mockWarn()
    await post({ ...BASE_METRIC, path: '/quemsah/private-notes/deep/secret' }, '198.51.100.7')

    expect(warn).toHaveBeenCalledWith('Web vital', expect.objectContaining({ path: 'other' }))
  })

  it('logs a null path when the client omits it', async () => {
    const warn = mockWarn()
    await post(BASE_METRIC, '198.51.100.8')

    expect(warn).toHaveBeenCalledWith('Web vital', expect.objectContaining({ path: null }))
  })

  it('still rejects payloads with an unknown metric name', async () => {
    const warn = mockWarn()
    const response = await post({ name: 'REFERRER', rating: 'good', value: 1, path: '/obra/superpowers' }, '198.51.100.9')

    expect(response.status).toBe(400)
    expect(warn).not.toHaveBeenCalled()
  })
})

function mockWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {})
}

async function post(payload: Record<string, unknown>, clientIp = '198.51.100.1') {
  const request = new Request('http://localhost/api/vitals', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': clientIp },
    body: JSON.stringify(payload),
  })

  return POST(request)
}
