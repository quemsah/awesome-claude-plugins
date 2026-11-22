import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

import { REPO_PAGES_ENDING_IN_MD } from './lib/markdownPaths.ts'
import { proxy } from './proxy.ts'

const ORIGIN = 'https://awesomeclaudeplugins.com'

function responseFor(pathname: string, accept?: string, headers: Record<string, string> = {}) {
  return proxy(
    new NextRequest(`${ORIGIN}${pathname}`, {
      headers: { ...headers, ...(accept ? { accept } : {}) },
    })
  )
}

function isMarkdownResponse(pathname: string, accept: string) {
  const response = responseFor(pathname, accept)
  return response.status === 200 && response.headers.get('content-type')?.startsWith('text/markdown')
}

function rewrittenTo(pathname: string) {
  return responseFor(pathname).headers.get('x-middleware-rewrite')
}

function passesThrough(pathname: string, accept?: string) {
  const response = responseFor(pathname, accept)

  return response.headers.get('x-middleware-next') === '1' && response.headers.get('x-middleware-rewrite') === null
}

describe('proxy', () => {
  it('returns 404 for malformed traversal requests rather than an internal server error', () => {
    for (const path of [
      '/..∕..∕..∕etc/passwd',
      '/..�..�..�etc/passwd',
      '/owner%2F..%2F..%2Fetc%2Fpasswd',
      '/owner%5C..%5Cetc%5Cpasswd',
      '/owner%EF%BF%BDrepo',
    ]) {
      const response = responseFor(path)
      expect(response.status, path).toBe(404)
      expect(response.headers.get('x-middleware-rewrite')).toBeNull()
    }
  })

  it('continues to serve legitimate repository names and markdown paths', () => {
    expect(passesThrough('/valid-owner/repo.name')).toBe(true)
    expect(rewrittenTo('/valid-owner/repo.name.md')).toBe(`${ORIGIN}/api/markdown/valid-owner/repo.name`)
  })

  it('serves a repository markdown path from the markdown api', () => {
    const response = responseFor('/ykdojo/claude-code-tips.md')

    expect(response.headers.get('x-middleware-rewrite')).toBe(`${ORIGIN}/api/markdown/ykdojo/claude-code-tips`)
    expect(response.headers.get('x-robots-tag')).toBe('noindex')
  })

  it('serves the html page of a repository whose name itself ends in .md', () => {
    expect(passesThrough(`/${REPO_PAGES_ENDING_IN_MD[0]}`)).toBe(true)
  })

  it('serves the markdown of a .md-named repository from the doubled suffix', () => {
    const response = responseFor('/sstklen/yes.md.md')

    expect(response.headers.get('x-middleware-rewrite')).toBe(`${ORIGIN}/api/markdown/sstklen/yes.md`)
    expect(response.headers.get('x-robots-tag')).toBe('noindex')
  })

  it('resolves the markdown suffix without regard to case', () => {
    const response = responseFor('/YKDOJO/CLAUDE-CODE-TIPS.MD')

    expect(response.headers.get('x-middleware-rewrite')).toBe(`${ORIGIN}/api/markdown/YKDOJO/CLAUDE-CODE-TIPS`)
    expect(response.headers.get('x-robots-tag')).toBe('noindex')
    expect(passesThrough(`/${REPO_PAGES_ENDING_IN_MD[0].toUpperCase()}`)).toBe(true)
  })

  it('routes unknown markdown paths to the api so they are reported as missing there', () => {
    const response = responseFor('/no-such-owner/no-such-repo.md')

    expect(response.headers.get('x-middleware-rewrite')).toBe(`${ORIGIN}/api/markdown/no-such-owner/no-such-repo`)
    expect(response.headers.get('x-robots-tag')).toBe('noindex')
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

    expect(response.headers.get('content-type')).toContain('text/markdown')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('vary')).toBe('Accept')
    expect(response.headers.get('x-robots-tag')).toBeNull()
  })

  it('negotiates static pages that already publish markdown alternates', () => {
    expect(isMarkdownResponse('/about', 'text/markdown')).toBe(true)
    expect(isMarkdownResponse('/stats', 'text/markdown')).toBe(true)
  })

  it('negotiates repository detail pages through the markdown api', () => {
    const response = responseFor('/ykdojo/claude-code-tips', 'text/markdown')

    expect(response.headers.get('content-type')).toContain('text/markdown')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('vary')).toBe('Accept')
    expect(response.headers.get('x-robots-tag')).toBeNull()
  })

  it('negotiates the canonical html path of a repository whose name ends in .md', () => {
    const response = responseFor(`/${REPO_PAGES_ENDING_IN_MD[0]}`, 'text/markdown')

    expect(response.headers.get('content-type')).toContain('text/markdown')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('vary')).toBe('Accept')
    expect(response.headers.get('x-robots-tag')).toBeNull()
  })

  it('keeps a .md-named repository HTML page index policy separate from its Markdown alias', () => {
    const canonicalHtml = responseFor(`/${REPO_PAGES_ENDING_IN_MD[0]}`, 'text/html')
    const markdownAlias = responseFor(`/${REPO_PAGES_ENDING_IN_MD[0]}.md`)

    expect(canonicalHtml.headers.get('x-middleware-next')).toBe('1')
    expect(canonicalHtml.headers.get('x-robots-tag')).toBeNull()
    expect(markdownAlias.headers.get('x-middleware-rewrite')).toBe(`${ORIGIN}/api/markdown/${REPO_PAGES_ENDING_IN_MD[0]}`)
    expect(markdownAlias.headers.get('x-robots-tag')).toBe('noindex')
  })

  it('uses markdown for text wildcards but keeps html for an all-types wildcard', () => {
    expect(isMarkdownResponse('/', 'text/*')).toBe(true)
    expect(passesThrough('/ykdojo/claude-code-tips', '*/*')).toBe(true)
  })

  it('keeps html as the default representation', () => {
    const response = responseFor('/', 'text/html,application/xhtml+xml')

    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.headers.get('x-robots-tag')).toBeNull()
  })

  it('honors relative media type quality when html and markdown are both acceptable', () => {
    expect(passesThrough('/', 'text/markdown, text/html')).toBe(true)
    expect(passesThrough('/', 'text/html;q=1, text/markdown;q=0.5')).toBe(true)
    expect(isMarkdownResponse('/', 'text/html;q=0.5, text/markdown;q=1')).toBe(true)
  })

  it('does not negotiate markdown when it is explicitly unacceptable', () => {
    const response = responseFor('/', 'text/markdown;q=0, text/html;q=1')

    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.headers.get('x-robots-tag')).toBeNull()
  })

  it('keeps unsupported canonical Accept values on HTML', () => {
    const response = responseFor('/obra/superpowers', 'application/json')

    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.headers.get('x-robots-tag')).toBeNull()
  })

  it('keeps HTML canonical until an explicit Markdown preference wins', () => {
    const html = responseFor('/ykdojo/claude-code-tips', 'text/html;q=1, text/markdown;q=0.5')
    const markdown = responseFor('/ykdojo/claude-code-tips', 'text/html;q=0.5, text/markdown;q=1')

    expect(html.headers.get('x-middleware-next')).toBe('1')
    expect(markdown.headers.get('content-type')).toContain('text/markdown')
    expect(markdown.headers.get('vary')).toBe('Accept')
  })

  it('keeps searched and sorted home pages in html', () => {
    expect(passesThrough('/?q=mcp', 'text/markdown')).toBe(true)
    expect(passesThrough('/?sort=stars', 'text/markdown')).toBe(true)
  })

  it('does not misclassify browse pagination as a repository detail page', () => {
    expect(passesThrough('/browse/2', 'text/markdown')).toBe(true)
  })

  it('does not rewrite requests ending in .md under reserved roots to repository markdown', () => {
    expect(passesThrough('/api/catalog.md')).toBe(true)
    expect(passesThrough('/sitemap/0.md')).toBe(true)
    expect(passesThrough('/browse/2.md')).toBe(true)
  })

  it('keeps the direct markdown API accessible but always marks it noindex', () => {
    const response = responseFor('/api/markdown/wevm/curl', 'text/markdown', {
      'x-internal-canonical-markdown-variant': '1',
    })

    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.headers.get('x-robots-tag')).toBe('noindex')
  })

  it('does not apply Markdown noindex policy to other API, browse, or sitemap routes', () => {
    for (const path of ['/api/catalog.md', '/sitemap/0.md', '/browse/2.md']) {
      const response = responseFor(path)

      expect(response.headers.get('x-robots-tag'), path).toBeNull()
    }
  })

  it('marks case variants of the direct markdown API as noindex without rewriting them', () => {
    const response = responseFor('/API/markdown/wevm/curl')

    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.headers.get('x-robots-tag')).toBe('noindex')
  })
})
