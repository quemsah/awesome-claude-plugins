import { describe, expect, it } from 'vitest'
import { toRouteTemplate, UNMATCHED_ROUTE } from './webVitalsPath.ts'

const ROUTE_TEMPLATES = new Set(['/', '/about', '/privacy', '/stats', '/browse/[page]', '/[owner]/[repo]', UNMATCHED_ROUTE])

describe('toRouteTemplate', () => {
  it('keeps static pages as their own route', () => {
    expect(toRouteTemplate('/')).toBe('/')
    expect(toRouteTemplate('/about')).toBe('/about')
    expect(toRouteTemplate('/privacy')).toBe('/privacy')
    expect(toRouteTemplate('/stats')).toBe('/stats')
  })

  it('replaces owner and repository names with the catch-all template', () => {
    expect(toRouteTemplate('/obra/superpowers')).toBe('/[owner]/[repo]')
    expect(toRouteTemplate('/facebook/claude-code')).toBe('/[owner]/[repo]')
    expect(toRouteTemplate('/quemsah/my-private-notes')).toBe('/[owner]/[repo]')
  })

  it('replaces the catalog page number with the browse template', () => {
    expect(toRouteTemplate('/browse/1')).toBe('/browse/[page]')
    expect(toRouteTemplate('/browse/42')).toBe('/browse/[page]')
  })

  it('ignores a trailing slash', () => {
    expect(toRouteTemplate('/about/')).toBe('/about')
    expect(toRouteTemplate('/obra/superpowers/')).toBe('/[owner]/[repo]')
    expect(toRouteTemplate('//')).toBe('/')
    expect(toRouteTemplate('')).toBe('/')
  })

  it('collapses paths that are not pages to the unmatched route', () => {
    expect(toRouteTemplate('/search')).toBe(UNMATCHED_ROUTE)
    expect(toRouteTemplate('/browse')).toBe(UNMATCHED_ROUTE)
    expect(toRouteTemplate('/obra/superpowers/skills')).toBe(UNMATCHED_ROUTE)
  })

  it('bounds every result to the known route templates', () => {
    const craftedPaths = [
      '/../../../../etc/passwd',
      '/a/b/c/d/e/f/g/h',
      '/session/eyJhbGciOiS.random.jwt',
      '/a-very-long-unexpected-segment-name-that-goes-on-and-on',
      '/.well-known/security.txt',
      '/user/quems%2Fnotes',
      '/search/q?owner=quemsah',
      '/og/obra/superpowers',
      'javascript:alert(1)',
      '\\windows\\path',
      '/'.repeat(200),
    ]

    for (const path of craftedPaths) {
      expect(ROUTE_TEMPLATES.has(toRouteTemplate(path)), path).toBe(true)
    }
  })
})
