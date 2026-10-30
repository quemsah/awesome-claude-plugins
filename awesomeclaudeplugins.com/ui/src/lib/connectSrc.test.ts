import { afterEach, describe, expect, it, vi } from 'vitest'

const CONNECT_SRC = /connect-src([^;]*)/

async function connectSrc(e2eEnv: Array<[string, string | undefined]>): Promise<string> {
  vi.resetModules()
  vi.stubEnv('GITHUB_RAW_URL', undefined)
  for (const [key, value] of e2eEnv) {
    vi.stubEnv(key, value)
  }
  const config = (await import('../../next.config.ts')).default
  const route = (await config.headers?.())?.find((entry) => entry.source === '/:path*')
  const policy = route?.headers.find((header) => header.key === 'Content-Security-Policy')?.value
  if (!policy) throw new Error('Content-Security-Policy header is missing')
  return CONNECT_SRC.exec(policy)?.[1] ?? ''
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('connect-src and the e2e mock server', () => {
  it('follows MOCK_GITHUB_PORT so a mock off the default port stays reachable', async () => {
    const value = await connectSrc([
      ['PLAYWRIGHT_BASE_URL', 'http://127.0.0.1:3355'],
      ['MOCK_GITHUB_PORT', '3155'],
    ])
    expect(value).toContain('http://127.0.0.1:3155')
  })

  it('keeps the default mock port when no override is given', async () => {
    const value = await connectSrc([
      ['PLAYWRIGHT_BASE_URL', 'http://127.0.0.1:3311'],
      ['MOCK_GITHUB_PORT', undefined],
    ])
    expect(value).toContain('http://127.0.0.1:3100')
  })

  it('keeps the loopback mock out of the policy of a normal build', async () => {
    const value = await connectSrc([
      ['PLAYWRIGHT_BASE_URL', undefined],
      ['MOCK_GITHUB_PORT', '3155'],
    ])
    expect(value).not.toContain('127.0.0.1')
  })

  it('allows the origin GITHUB_API_URL points the browser at, apart from the raw origin', async () => {
    const value = await connectSrc([['GITHUB_API_URL', 'https://gh-api.internal.example']])

    expect(value).toContain('https://gh-api.internal.example')
  })

  it('keeps api.github.com in the policy when no API override is given', async () => {
    const value = await connectSrc([['GITHUB_API_URL', undefined]])

    expect(value).toContain('https://api.github.com')
  })
})
