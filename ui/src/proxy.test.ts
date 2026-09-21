import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

import { proxy } from './proxy.ts'

const ORIGIN = 'https://awesomeclaudeplugins.com'

function rewrittenTo(pathname: string) {
  return proxy(new NextRequest(`${ORIGIN}${pathname}`)).headers.get('x-middleware-rewrite')
}

function passesThrough(pathname: string) {
  const response = proxy(new NextRequest(`${ORIGIN}${pathname}`))

  return response.headers.get('x-middleware-next') === '1' && response.headers.get('x-middleware-rewrite') === null
}

describe('proxy', () => {
  it('serves a repository markdown path from the markdown api', () => {
    expect(rewrittenTo('/ykdojo/claude-code-tips.md')).toBe(`${ORIGIN}/api/markdown/ykdojo/claude-code-tips`)
  })

  it('serves the html page of a repository whose name itself ends in .md', () => {
    expect(passesThrough('/sstklen/yes.md')).toBe(true)
    expect(passesThrough('/wevm/curl.md')).toBe(true)
  })

  it('serves the markdown of a .md-named repository from the doubled suffix', () => {
    expect(rewrittenTo('/sstklen/yes.md.md')).toBe(`${ORIGIN}/api/markdown/sstklen/yes.md`)
  })

  it('resolves the markdown suffix without regard to case', () => {
    expect(rewrittenTo('/YKDOJO/CLAUDE-CODE-TIPS.MD')).toBe(`${ORIGIN}/api/markdown/YKDOJO/CLAUDE-CODE-TIPS`)
    expect(passesThrough('/Sstklen/Yes.md')).toBe(true)
    expect(passesThrough('/jordantplows/STARTUP-OS.MD')).toBe(true)
  })

  it('routes unknown markdown paths to the api so they are reported as missing there', () => {
    expect(rewrittenTo('/no-such-owner/no-such-repo.md')).toBe(`${ORIGIN}/api/markdown/no-such-owner/no-such-repo`)
  })

  it('leaves single-segment markdown documents to their own routes', () => {
    expect(passesThrough('/about.md')).toBe(true)
    expect(passesThrough('/SKILL.md')).toBe(true)
  })

  it('leaves paths without the markdown suffix alone', () => {
    expect(passesThrough('/sstklen/yes')).toBe(true)
    expect(passesThrough('/api/markdown/sstklen/yes.md')).toBe(true)
  })

  it('keeps the query string of a markdown request', () => {
    const response = proxy(new NextRequest(`${ORIGIN}/ykdojo/claude-code-tips.md?section=plugins`))

    expect(response.headers.get('x-middleware-rewrite')).toBe(`${ORIGIN}/api/markdown/ykdojo/claude-code-tips?section=plugins`)
  })
})
