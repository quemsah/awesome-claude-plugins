import { describe, expect, it } from 'vitest'
import * as markdownRoute from './route.ts'

const CATALOG_REPO = ['ykdojo', 'claude-code-tips']
const UNKNOWN_REPO = ['no-such-owner', 'no-such-repo']

function context(repo: string[]) {
  return { params: Promise.resolve({ repo }) }
}

function requestFor(repo: string[]) {
  return new Request(`https://awesomeclaudeplugins.com/api/markdown/${repo.join('/')}`)
}

describe('GET /api/markdown/[...repo]', () => {
  it('labels the payload as markdown', async () => {
    const response = await markdownRoute.GET(requestFor(CATALOG_REPO), context(CATALOG_REPO))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
  })

  it('lets any origin read the catalog markdown', async () => {
    const response = await markdownRoute.GET(requestFor(CATALOG_REPO), context(CATALOG_REPO))

    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('keeps CORS on 404 so agents can read why a lookup failed', async () => {
    const response = await markdownRoute.GET(requestFor(UNKNOWN_REPO), context(UNKNOWN_REPO))

    expect(response.status).toBe(404)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('keeps CORS on the malformed-path 404', async () => {
    const response = await markdownRoute.GET(requestFor(['single-segment']), context(['single-segment']))

    expect(response.status).toBe(404)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })
})

describe('OPTIONS /api/markdown/[...repo]', () => {
  it('answers preflight with the readable methods', () => {
    const options = markdownRoute.OPTIONS
    expect(options).toBeTypeOf('function')

    const response = options(requestFor(CATALOG_REPO))

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('access-control-allow-methods')).toContain('GET')
  })
})
