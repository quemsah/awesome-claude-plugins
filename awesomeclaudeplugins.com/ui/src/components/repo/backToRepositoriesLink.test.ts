import { describe, expect, it } from 'vitest'
import { resolveSafeInternalUrl } from './BackToRepositoriesLink.tsx'

describe('resolveSafeInternalUrl', () => {
  it('preserves valid internal paths', () => {
    expect(resolveSafeInternalUrl('/')).toBe('/')
    expect(resolveSafeInternalUrl('/browse/2')).toBe('/browse/2')
    expect(resolveSafeInternalUrl('/?q=claude')).toBe('/?q=claude')
    expect(resolveSafeInternalUrl('/stats')).toBe('/stats')
  })

  it('rejects protocol-relative URLs and falls back to root', () => {
    expect(resolveSafeInternalUrl('//evil.com')).toBe('/')
    expect(resolveSafeInternalUrl('//attacker.example/phish')).toBe('/')
    expect(resolveSafeInternalUrl('///something')).toBe('/')
    expect(resolveSafeInternalUrl('/\\attacker.com')).toBe('/')
  })

  it('rejects control characters and backslashes that URLs can reinterpret as external navigation', () => {
    for (const malicious of [
      '/\t/evil.com',
      '/\n/evil.com',
      '/\r/evil.com',
      '/\\evil.com',
      '/foo\\bar',
      '/\u0000/evil.com',
      '/\u007f/evil.com',
      ' //evil.com',
    ]) {
      expect(resolveSafeInternalUrl(malicious)).toBe('/')
    }
  })

  it('returns a normalized same-origin path, including search and hash', () => {
    expect(resolveSafeInternalUrl('/browse/../?q=claude#search')).toBe('/?q=claude#search')
    expect(resolveSafeInternalUrl('/?q=encoded%20query')).toBe('/?q=encoded%20query')
  })

  it('rejects non-root URLs, relative paths, and malicious schemes', () => {
    expect(resolveSafeInternalUrl('https://google.com')).toBe('/')
    expect(resolveSafeInternalUrl('javascript:alert(1)')).toBe('/')
    expect(resolveSafeInternalUrl('data:text/html,alert(1)')).toBe('/')
    expect(resolveSafeInternalUrl('relative/path')).toBe('/')
  })

  it('falls back to root on nullish or non-string inputs', () => {
    expect(resolveSafeInternalUrl(null)).toBe('/')
    expect(resolveSafeInternalUrl(undefined)).toBe('/')
    expect(resolveSafeInternalUrl('')).toBe('/')
  })
})
