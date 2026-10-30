import { describe, expect, it } from 'vitest'
import { getRateLimitKey, RateLimiter } from './rateLimit.ts'

describe('RateLimiter', () => {
  it('limits requests within a window and accepts requests after expiry', () => {
    const limiter = new RateLimiter(10, 2, 1_000)

    expect(limiter.isRateLimited('client', 100)).toBe(false)
    expect(limiter.isRateLimited('client', 200)).toBe(false)
    expect(limiter.isRateLimited('client', 300)).toBe(true)
    expect(limiter.isRateLimited('client', 1_100)).toBe(false)
  })

  it('evicts the oldest client when the capacity is exhausted', () => {
    const limiter = new RateLimiter(2, 1, 1_000)

    expect(limiter.isRateLimited('first', 100)).toBe(false)
    expect(limiter.isRateLimited('second', 200)).toBe(false)
    expect(limiter.isRateLimited('third', 300)).toBe(false)
    expect(limiter.isRateLimited('first', 400)).toBe(false)
  })

  it('keeps counting an active client that is re-seen while the map is full', () => {
    const limiter = new RateLimiter(2, 1, 1_000)

    expect(limiter.isRateLimited('first', 100)).toBe(false)
    expect(limiter.isRateLimited('second', 200)).toBe(false)
    expect(limiter.isRateLimited('second', 300)).toBe(true)
  })

  it('reclaims expired entries instead of evicting an active client', () => {
    const limiter = new RateLimiter(2, 1, 1_000)

    expect(limiter.isRateLimited('expired', 100)).toBe(false)
    expect(limiter.isRateLimited('active', 1_500)).toBe(false)
    expect(limiter.isRateLimited('newcomer', 1_600)).toBe(false)
    expect(limiter.isRateLimited('active', 1_700)).toBe(true)
  })
})

describe('getRateLimitKey', () => {
  it('uses platform-controlled headers and ignores spoofable Cloudflare headers by default', () => {
    expect(getRateLimitKey(new Headers({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '203.0.113.5' }), {})).toBe('203.0.113.5')
    expect(getRateLimitKey(new Headers({ 'x-vercel-forwarded-for': '198.51.100.9', 'x-forwarded-for': '203.0.113.5' }), {})).toBe(
      '198.51.100.9'
    )
    expect(getRateLimitKey(new Headers({ 'x-real-ip': '198.51.100.8', 'x-forwarded-for': '203.0.113.5' }), {})).toBe('198.51.100.8')
    expect(getRateLimitKey(new Headers({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }), {})).toBe('203.0.113.5')
    expect(getRateLimitKey(new Headers(), {})).toBe('unknown')
  })

  it('honors the Cloudflare header only when the deployment opts in', () => {
    expect(
      getRateLimitKey(new Headers({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '203.0.113.5' }), {
        // biome-ignore lint/style/useNamingConvention: environment variables are SCREAMING_SNAKE_CASE
        TRUST_CF_CONNECTING_IP: 'true',
      })
    ).toBe('198.51.100.7')
  })
})
