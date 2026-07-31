type RateLimitEntry = {
  count: number
  resetAt: number
}

export class RateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>()

  constructor(
    private readonly maxEntries: number,
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {}

  isRateLimited(key: string, now = Date.now()): boolean {
    const existing = this.entries.get(key)
    const active = existing && existing.resetAt > now ? existing : undefined

    if (active && active.count >= this.maxRequests) {
      return true
    }

    if (!active) {
      this.evictIfNeeded(now)
    }

    // Re-inserting keeps the Map ordered by last activity so eviction drops the stalest client.
    this.entries.delete(key)
    this.entries.set(key, {
      count: active ? active.count + 1 : 1,
      resetAt: active ? active.resetAt : now + this.windowMs,
    })
    return false
  }

  // Expired entries are reclaimed lazily under capacity pressure so a single request never
  // pays for a full scan of the map.
  private evictIfNeeded(now: number) {
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.entries().next()
      if (oldest.done) {
        return
      }

      const [oldestKey, oldestEntry] = oldest.value
      this.entries.delete(oldestKey)
      if (oldestEntry.resetAt > now) {
        return
      }
    }
  }
}

/**
 * Derives a rate-limit key from headers the hosting platform is known to control.
 *
 * `cf-connecting-ip` is only honored when the deployment explicitly declares that it sits behind
 * Cloudflare: any client can send that header straight to an origin that is not fronted by
 * Cloudflare and thereby mint an unlimited number of fresh buckets.
 */
export function getRateLimitKey(headers: Headers, env: Record<string, string | undefined> = process.env): string {
  const trustedHeaders = env.TRUST_CF_CONNECTING_IP === 'true' ? ['cf-connecting-ip', 'x-real-ip'] : ['x-vercel-forwarded-for', 'x-real-ip']

  for (const header of trustedHeaders) {
    const value = headers.get(header)?.split(',')[0]?.trim()
    if (value) {
      return value
    }
  }

  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}
