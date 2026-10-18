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
