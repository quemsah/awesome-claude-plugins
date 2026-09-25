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

function integerHeader(headers: Headers | undefined, name: string): number | undefined {
  const value = headers?.get(name)
  return value !== null && value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined
}

function validDateTimestamp(value: number): number | undefined {
  return Number.isFinite(value) && Math.abs(value) <= 8_640_000_000_000_000 ? value : undefined
}

function resetHeaderTimestamp(headers: Headers | undefined): number | undefined {
  const reset = integerHeader(headers, 'x-ratelimit-reset')
  return reset === undefined ? undefined : validDateTimestamp(reset * 1_000)
}

export class RateBudget {
  private readonly sent: Record<RateResource, number[]> = { code_search: [], core: [], graphql: [] }
  private readonly blockedUntil: Record<RateResource, number> = { code_search: 0, core: 0, graphql: 0 }
  private readonly lastSent: Record<RateResource, number | null> = { code_search: null, core: null, graphql: null }
  private graphqlQuota: { limit: number; remaining: number; resetAt: number; lastCost: number } | null = null
  private reservations: Promise<void> = Promise.resolve()

  constructor(
    private readonly clock: Clock = systemClock,
    private readonly log?: RateLog,
    private readonly pacingMs: Partial<Record<RateResource, number>> = {},
  ) {}

  private graphQLQuotaDeadline(bucket: RateResource, now: number, expectedCost: number): number {
    if (bucket !== 'graphql' || this.graphqlQuota === null) return now
    const reserve = Math.ceil(this.graphqlQuota.limit * 0.1)
    const usable = this.graphqlQuota.remaining - reserve
    const projectedCost = Math.max(1, this.graphqlQuota.lastCost, expectedCost)
    if (usable < projectedCost) return this.graphqlQuota.resetAt + 1_000
    const remainingWindowMs = this.graphqlQuota.resetAt - now
    const lastSent = this.lastSent.graphql
    if (remainingWindowMs <= 0 || lastSent === null) return now

    const affordableRequests = Math.max(1, Math.floor(usable / projectedCost))
    const smoothSpacingMs = Math.ceil(remainingWindowMs / affordableRequests)
    return Math.max(now, lastSent + smoothSpacingMs)
  }

  acquire(bucket: RateResource, signal?: AbortSignal, expectedCost = 1): Promise<void> {
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
          this.graphQLQuotaDeadline(bucket, now, expectedCost),
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

  private updateGraphQLQuota(headers: Headers, remaining: number): void {
    const resetAt = resetHeaderTimestamp(headers)
    this.graphqlQuota = {
      limit: integerHeader(headers, 'x-ratelimit-limit') ?? this.graphqlQuota?.limit ?? 5_000,
      remaining,
      resetAt: resetAt ?? this.graphqlQuota?.resetAt ?? this.clock.now() + rules.graphql.windowMs,
      lastCost: this.graphqlQuota?.lastCost ?? 1,
    }
  }

  observe(expected: RateResource, headers: Headers): void {
    const resource = headers.get('x-ratelimit-resource')
    const bucket: RateResource = resource === 'core' || resource === 'code_search' || resource === 'graphql' ? resource : expected
    const remaining = integerHeader(headers, 'x-ratelimit-remaining')
    this.log?.({ bucket, ...(remaining === undefined ? {} : { remaining }) })

    if (bucket === 'graphql' && remaining !== undefined) this.updateGraphQLQuota(headers, remaining)
    if (remaining !== 0) return

    const resetAt = resetHeaderTimestamp(headers)
    const deadline = resetAt === undefined ? this.clock.now() + rules[bucket].windowMs : resetAt + 1_000
    this.blockedUntil[bucket] = Math.max(this.blockedUntil[bucket], deadline)
  }

  observeGraphQL(rateLimit: GraphQLRateObservation, headers?: Headers): void {
    const limit = integerHeader(headers, 'x-ratelimit-limit') ?? rateLimit.limit
    const remaining = integerHeader(headers, 'x-ratelimit-remaining') ?? rateLimit.remaining
    const used = integerHeader(headers, 'x-ratelimit-used') ?? rateLimit.used
    const headerResetAt = resetHeaderTimestamp(headers)
    const payloadResetAt = validDateTimestamp(Date.parse(rateLimit.resetAt))
    const resetAt = headerResetAt ?? payloadResetAt ?? this.graphqlQuota?.resetAt ?? this.clock.now() + rules.graphql.windowMs
    this.graphqlQuota = { limit, remaining, resetAt, lastCost: rateLimit.cost }
    this.log?.({
      bucket: 'graphql',
      cost: rateLimit.cost,
      limit,
      remaining,
      used,
      resetAt: new Date(this.graphqlQuota.resetAt).toISOString(),
      ...(rateLimit.latencyMs === undefined ? {} : { latencyMs: rateLimit.latencyMs }),
    })
    if (remaining === 0) {
      this.blockedUntil.graphql = Math.max(this.blockedUntil.graphql, this.graphqlQuota.resetAt + 1_000)
    }
  }

  defer(bucket: RateResource, durationMs: number): void {
    this.blockedUntil[bucket] = Math.max(this.blockedUntil[bucket], this.clock.now() + durationMs)
  }
}
