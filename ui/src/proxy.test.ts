import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

import { REPO_PAGES_ENDING_IN_MD } from './lib/markdownPaths.ts'
import { proxy } from './proxy.ts'

const ORIGIN = 'https://awesomeclaudeplugins.com'

function responseFor(pathname: string, accept?: string) {
  return proxy(
    new NextRequest(`${ORIGIN}${pathname}`, {
      headers: accept ? { Accept: accept } : undefined,
    }),
  )
}

function rewrittenTo(pathname: string, accept?: string) {
  return responseFor(pathname, accept).headers.get('x-middleware-rewrite')
}

function passesThrough(pathname: string, accept?: string) {
  const response = responseFor(pathname, accept)

  return response.headers.get('x-middleware-next') === '1' && response.headers.get('x-middleware-rewrite') === null
}

describe('proxy', () => {
  it('serves a repository markdown path from the markdown api', () => {
    expect(rewrittenTo('/ykdojo/claude-code-tips.md')).toBe(`${ORIGIN}/api/markdown/ykdojo/claude-code-tips`)
  })

  it('serves the html page of a repository whose name itself ends in .md', () => {
    expect(passesThrough(`/${REPO_PAGES_ENDING_IN_MD[0]}`)).toBe(true)
  })

  it('serves the markdown of a .md-named repository from the doubled suffix', () => {
    expect(rewrittenTo('/sstklen/yes.md.md')).toBe(`${ORIGIN}/api/markdown/sstklen/yes.md`)
  })

  it('resolves the markdown suffix without regard to case', () => {
    expect(rewrittenTo('/YKDOJO/CLAUDE-CODE-TIPS.MD')).toBe(`${ORIGIN}/api/markdown/YKDOJO/CLAUDE-CODE-TIPS`)
    expect(passesThrough(`/${REPO_PAGES_ENDING_IN_MD[0].toUpperCase()}`)).toBe(true)
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
    const response = responseFor('/ykdojo/claude-code-tips.md?section=plugins')

    expect(response.headers.get('x-middleware-rewrite')).toBe(`${ORIGIN}/api/markdown/ykdojo/claude-code-tips?section=plugins`)
  })

  it('negotiates the home page to its markdown representation', () => {
    const response = responseFor('/', 'text/markdown')

    expect(response.headers.get('x-middleware-rewrite')).toBe(`${ORIGIN}/index.md`)
    expect(response.headers.get('vary')).toBe('Accept')
  })

  it('negotiates static pages that already publish markdown alternates', () => {
    expect(rewrittenTo('/about', 'text/markdown')).toBe(`${ORIGIN}/about.md`)
    expect(rewrittenTo('/stats', 'text/markdown')).toBe(`${ORIGIN}/stats.md`)
  })

  it('negotiates repository detail pages through the markdown api', () => {
    expect(rewrittenTo('/ykdojo/claude-code-tips', 'text/markdown')).toBe(`${ORIGIN}/api/markdown/ykdojo/claude-code-tips`)
  })

  it('negotiates the canonical html path of a repository whose name ends in .md', () => {
    expect(rewrittenTo(`/${REPO_PAGES_ENDING_IN_MD[0]}`, 'text/markdown')).toBe(
      `${ORIGIN}/api/markdown/${REPO_PAGES_ENDING_IN_MD[0]}`,
    )
  })

  it('keeps html as the default representation', () => {
    expect(passesThrough('/', 'text/html,application/xhtml+xml')).toBe(true)
    expect(passesThrough('/ykdojo/claude-code-tips', '*/*')).toBe(true)
  })

  it('does not negotiate markdown when it is explicitly unacceptable', () => {
    expect(passesThrough('/', 'text/markdown;q=0, text/html;q=1')).toBe(true)
  })

  it('does not misclassify browse pagination as a repository detail page', () => {
    expect(passesThrough('/browse/2', 'text/markdown')).toBe(true)
  })
})
