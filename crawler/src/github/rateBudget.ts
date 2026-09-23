import { sleepWithShutdown, throwIfShutdown } from '../shutdown.js'

export type RateResource = 'code_search' | 'core'

export type Clock = {
  now: () => number
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>
}

export type RateLog = (event: { bucket: RateResource; request?: true; remaining?: number; waitMs?: number }) => void
export type GitHubRateBuckets = Record<RateResource, { requests: number; waitMs: number; lastRemaining: number | null }>

const rules: Record<RateResource, { limit: number; windowMs: number; spacingMs: number }> = {
  code_search: { limit: 10, windowMs: 60_000, spacingMs: 6_200 },
  core: { limit: 5_000, windowMs: 3_600_000, spacingMs: 750 },
}

export const systemClock: Clock = {
  now: Date.now,
  sleep: sleepWithShutdown,
}

export class RateBudget {
  private readonly sent: Record<RateResource, number[]> = { code_search: [], core: [] }
  private readonly blockedUntil: Record<RateResource, number> = { code_search: 0, core: 0 }
  private readonly lastSent: Record<RateResource, number | null> = { code_search: null, core: null }
  private reservations: Promise<void> = Promise.resolve()

  constructor(
    private readonly clock: Clock = systemClock,
    private readonly log?: RateLog,
    private readonly pacingMs: Partial<Record<RateResource, number>> = {},
  ) {}

  acquire(bucket: RateResource, signal?: AbortSignal): Promise<void> {
    const reservation = this.reservations.then(async () => {
      throwIfShutdown(signal)
      const rule = rules[bucket]
      while (true) {
        throwIfShutdown(signal)
        const now = this.clock.now()
        const recent = this.sent[bucket]
        while (recent.length && recent[0] <= now - rule.windowMs) recent.shift()

        const deadline = Math.max(
          this.blockedUntil[bucket],
          this.lastSent[bucket] === null ? now : this.lastSent[bucket] + (this.pacingMs[bucket] ?? rule.spacingMs),
          recent.length >= rule.limit ? recent[0] + rule.windowMs : now,
        )
        if (deadline <= now) {
          recent.push(now)
          this.lastSent[bucket] = now
          throwIfShutdown(signal)
          this.log?.({ bucket, request: true })
          return
        }
        const waitMs = deadline - now
        this.log?.({ bucket, waitMs })
        await this.clock.sleep(waitMs, signal)
      }
    })
    this.reservations = reservation.catch(() => {})
    return reservation
  }

  observe(expected: RateResource, headers: Headers): void {
    const resource = headers.get('x-ratelimit-resource')
    const bucket: RateResource = resource === 'core' || resource === 'code_search' ? resource : expected
    const remainingValue = headers.get('x-ratelimit-remaining')
    const remaining = remainingValue !== null && /^\d+$/.test(remainingValue) ? Number(remainingValue) : undefined
    this.log?.({ bucket, ...(remaining === undefined ? {} : { remaining }) })

    if (remaining === 0) {
      const resetValue = headers.get('x-ratelimit-reset')
      const reset = resetValue !== null && /^\d+$/.test(resetValue) ? Number(resetValue) * 1000 : null
      this.blockedUntil[bucket] = Math.max(
        this.blockedUntil[bucket],
        reset === null ? this.clock.now() + rules[bucket].windowMs : reset + 1_000,
      )
    }
  }

  defer(bucket: RateResource, durationMs: number): void {
    this.blockedUntil[bucket] = Math.max(this.blockedUntil[bucket], this.clock.now() + durationMs)
  }
}
