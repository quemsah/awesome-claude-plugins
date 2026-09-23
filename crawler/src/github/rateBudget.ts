import { sleepWithShutdown, throwIfShutdown } from '../shutdown.js'

export type RateResource = 'code_search' | 'core' | 'graphql'

export type Clock = {
  now: () => number
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>
}

export type RateLog = (event: {
  bucket: RateResource
  request?: true
  remaining?: number
  waitMs?: number
  cost?: number
  limit?: number
  used?: number
  resetAt?: string
  latencyMs?: number
}) => void
type RateBucketSummary = { requests: number; waitMs: number; lastRemaining: number | null }
export type GitHubRateBuckets = {
  code_search: RateBucketSummary
  core: RateBucketSummary
  graphql?: RateBucketSummary & {
    totalCost: number
    lastCost: number | null
    lastLimit: number | null
    lastUsed: number | null
    resetAt: string | null
    totalLatencyMs?: number
    latencySamples?: number
    lastLatencyMs?: number | null
  }
}
export type GraphQLRateObservation = { cost: number; remaining: number; resetAt: string; limit: number; used: number; latencyMs?: number }

const rules: Record<RateResource, { limit: number; windowMs: number; spacingMs: number }> = {
  code_search: { limit: 10, windowMs: 60_000, spacingMs: 6_200 },
  core: { limit: 5_000, windowMs: 3_600_000, spacingMs: 750 },
  graphql: { limit: 5_000, windowMs: 3_600_000, spacingMs: 750 },
}

export const systemClock: Clock = {
  now: Date.now,
  sleep: sleepWithShutdown,
}

export class RateBudget {
  private readonly sent: Record<RateResource, number[]> = { code_search: [], core: [], graphql: [] }
  private readonly blockedUntil: Record<RateResource, number> = { code_search: 0, core: 0, graphql: 0 }
  private readonly lastSent: Record<RateResource, number | null> = { code_search: null, core: null, graphql: null }
  private graphqlQuota: { limit: number; remaining: number; resetAt: number | null; lastCost: number } | null = null
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
          bucket === 'graphql' &&
            this.graphqlQuota &&
            this.graphqlQuota.remaining - this.graphqlQuota.lastCost < Math.ceil(this.graphqlQuota.limit * 0.1)
            ? (this.graphqlQuota.resetAt ?? now + rule.windowMs) + 1_000
            : now,
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
    const bucket: RateResource = resource === 'core' || resource === 'code_search' || resource === 'graphql' ? resource : expected
    const remainingValue = headers.get('x-ratelimit-remaining')
    const remaining = remainingValue !== null && /^\d+$/.test(remainingValue) ? Number(remainingValue) : undefined
    this.log?.({ bucket, ...(remaining === undefined ? {} : { remaining }) })

    if (bucket === 'graphql' && remaining !== undefined) {
      const limitValue = headers.get('x-ratelimit-limit')
      const resetValue = headers.get('x-ratelimit-reset')
      this.graphqlQuota = {
        limit: limitValue !== null && /^\d+$/.test(limitValue) ? Number(limitValue) : (this.graphqlQuota?.limit ?? 5_000),
        remaining,
        resetAt: resetValue !== null && /^\d+$/.test(resetValue) ? Number(resetValue) * 1_000 : (this.graphqlQuota?.resetAt ?? null),
        lastCost: this.graphqlQuota?.lastCost ?? 1,
      }
    }

    if (remaining === 0) {
      const resetValue = headers.get('x-ratelimit-reset')
      const reset = resetValue !== null && /^\d+$/.test(resetValue) ? Number(resetValue) * 1000 : null
      this.blockedUntil[bucket] = Math.max(
        this.blockedUntil[bucket],
        reset === null ? this.clock.now() + rules[bucket].windowMs : reset + 1_000,
      )
    }
  }

  observeGraphQL(rateLimit: GraphQLRateObservation, headers?: Headers): void {
    const headerLimit = headers?.get('x-ratelimit-limit')
    const headerRemaining = headers?.get('x-ratelimit-remaining')
    const headerUsed = headers?.get('x-ratelimit-used')
    const headerReset = headers?.get('x-ratelimit-reset')
    const limit = headerLimit !== null && headerLimit !== undefined && /^\d+$/.test(headerLimit) ? Number(headerLimit) : rateLimit.limit
    const remaining =
      headerRemaining !== null && headerRemaining !== undefined && /^\d+$/.test(headerRemaining)
        ? Number(headerRemaining)
        : rateLimit.remaining
    const used = headerUsed !== null && headerUsed !== undefined && /^\d+$/.test(headerUsed) ? Number(headerUsed) : rateLimit.used
    const resetAt =
      headerReset !== null && headerReset !== undefined && /^\d+$/.test(headerReset)
        ? Number(headerReset) * 1_000
        : Date.parse(rateLimit.resetAt)
    this.graphqlQuota = { limit, remaining, resetAt: Number.isFinite(resetAt) ? resetAt : null, lastCost: rateLimit.cost }
    this.log?.({
      bucket: 'graphql',
      cost: rateLimit.cost,
      limit,
      remaining,
      used,
      resetAt: rateLimit.resetAt,
      ...(rateLimit.latencyMs === undefined ? {} : { latencyMs: rateLimit.latencyMs }),
    })
    if (remaining === 0 && this.graphqlQuota.resetAt !== null) {
      this.blockedUntil.graphql = Math.max(this.blockedUntil.graphql, this.graphqlQuota.resetAt + 1_000)
    }
  }

  defer(bucket: RateResource, durationMs: number): void {
    this.blockedUntil[bucket] = Math.max(this.blockedUntil[bucket], this.clock.now() + durationMs)
  }
}
