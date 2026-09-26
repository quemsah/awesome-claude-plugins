import { describe, expect, it } from 'vitest'
import { RateBudget } from './rateBudget.js'

function virtualClock() {
  let time = 0
  const sleeps: number[] = []
  return {
    now: () => time,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      time += ms
    },
    get time() {
      return time
    },
    sleeps,
  }
}

describe('RateBudget', () => {
  it('ignores an out-of-range GraphQL reset header and uses the payload reset time', () => {
    const events: Parameters<NonNullable<ConstructorParameters<typeof RateBudget>[1]>>[0][] = []
    const clock = virtualClock()
    const budget = new RateBudget(clock, (event) => events.push(event))
    const payloadResetAt = '2030-01-01T00:00:00Z'
    const headers = new Headers({
      'x-ratelimit-resource': 'graphql',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '100',
      'x-ratelimit-used': '4900',
      'x-ratelimit-reset': '9999999999999',
    })

    expect(() =>
      budget.observeGraphQL({ cost: 1, remaining: 100, resetAt: payloadResetAt, limit: 5000, used: 4900 }, headers),
    ).not.toThrow()

    expect(events.at(-1)).toMatchObject({
      bucket: 'graphql',
      resetAt: new Date(payloadResetAt).toISOString(),
    })
  })

  it('logs the effective GraphQL reset time used by the budget', () => {
    const events: Parameters<NonNullable<ConstructorParameters<typeof RateBudget>[1]>>[0][] = []
    const clock = virtualClock()
    const budget = new RateBudget(clock, (event) => events.push(event))
    const headers = new Headers({
      'x-ratelimit-resource': 'graphql',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '100',
      'x-ratelimit-used': '4900',
      'x-ratelimit-reset': '2000000000',
    })

    budget.observeGraphQL({ cost: 1, remaining: 100, resetAt: '2030-01-01T00:00:00Z', limit: 5000, used: 4900 }, headers)

    expect(events.at(-1)).toMatchObject({
      bucket: 'graphql',
      resetAt: new Date(2_000_000_000_000).toISOString(),
    })
  })

  it('keeps eleven code searches within the sliding ten-per-minute quota', async () => {
    const clock = virtualClock()
    const budget = new RateBudget(clock)
    const sent: number[] = []

    for (let i = 0; i < 11; i++) {
      await budget.acquire('code_search')
      sent.push(clock.time)
    }

    expect(sent[0]).toBe(0)
    expect(sent[10]).toBeGreaterThanOrEqual(60_000)
    for (let i = 10; i < sent.length; i++) expect(sent[i] - sent[i - 10]).toBeGreaterThanOrEqual(60_000)
  })

  it('never sends more than 5000 core requests in a sliding hour', async () => {
    const clock = virtualClock()
    const budget = new RateBudget(clock, undefined, { core: 0 })
    const sent: number[] = []

    for (let i = 0; i < 5001; i++) {
      await budget.acquire('core')
      sent.push(clock.time)
    }

    expect(sent[5000] - sent[0]).toBeGreaterThanOrEqual(3_600_000)
    for (let i = 5000; i < sent.length; i++) expect(sent[i] - sent[i - 5000]).toBeGreaterThanOrEqual(3_600_000)
  })

  it('enforces the search sliding window even without conservative pacing', async () => {
    const clock = virtualClock()
    const budget = new RateBudget(clock, undefined, { code_search: 0 })
    for (let i = 0; i < 10; i++) {
      await budget.acquire('code_search')
      expect(clock.time).toBe(0)
    }
    await budget.acquire('code_search')
    expect(clock.time).toBe(60_000)
  })

  it('paces default searches and enrichment requests independently', async () => {
    const clock = virtualClock()
    const budget = new RateBudget(clock)
    await budget.acquire('code_search')
    await budget.acquire('core')
    await budget.acquire('core')
    expect(clock.time).toBeGreaterThanOrEqual(750)
    await budget.acquire('code_search')
    expect(clock.time).toBeGreaterThanOrEqual(6_200)
  })

  it('uses actual response resource and waits for exhausted core reset without blocking code search', async () => {
    const clock = virtualClock()
    const budget = new RateBudget(clock)
    await budget.acquire('core')
    budget.observe(
      'core',
      new Headers({
        'x-ratelimit-resource': 'core',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': '120',
      }),
    )

    await budget.acquire('code_search')
    expect(clock.time).toBe(0)
    await budget.acquire('core')
    expect(clock.time).toBeGreaterThan(120_000)
  })

  it('honors a longer server reset even when local pacing has already elapsed', async () => {
    const clock = virtualClock()
    const budget = new RateBudget(clock)
    await budget.acquire('code_search')
    budget.observe(
      'core',
      new Headers({
        'x-ratelimit-resource': 'code_search',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': '90',
      }),
    )
    await budget.acquire('code_search')
    expect(clock.time).toBeGreaterThan(90_000)
  })

  it('uses one fixed fallback reset when GraphQL headers omit x-ratelimit-reset', async () => {
    let time = 0
    let sleeps = 0
    const budget = new RateBudget({
      now: () => time,
      sleep: async (milliseconds: number) => {
        sleeps++
        if (sleeps > 1) throw new Error('GraphQL fallback reset moved while waiting')
        time += milliseconds
      },
    })
    budget.observe(
      'graphql',
      new Headers({
        'x-ratelimit-resource': 'graphql',
        'x-ratelimit-limit': '5000',
        'x-ratelimit-remaining': '500',
      }),
    )

    await budget.acquire('graphql')

    expect(sleeps).toBe(1)
    expect(time).toBe(3_601_000)
  })

  it('holds GraphQL batches before they can consume the 10 percent primary quota reserve', async () => {
    const clock = virtualClock()
    const budget = new RateBudget(clock)
    await budget.acquire('graphql')
    budget.observeGraphQL({
      cost: 100,
      remaining: 550,
      resetAt: new Date(120_000).toISOString(),
      limit: 5_000,
      used: 4_450,
    })

    await budget.acquire('graphql')
    expect(clock.time).toBeGreaterThanOrEqual(121_000)
  })

  it('serializes simultaneous reservations rather than sending a burst', async () => {
    const clock = virtualClock()
    const budget = new RateBudget(clock)
    const sent = await Promise.all(
      Array.from({ length: 11 }, async () => {
        await budget.acquire('code_search')
        return clock.time
      }),
    )

    expect(sent[10] - sent[0]).toBeGreaterThanOrEqual(60_000)
  })

  it('holds retries until the deferred deadline and never shortens an existing reset', async () => {
    const clock = virtualClock()
    const budget = new RateBudget(clock)
    budget.defer('core', 90_000)
    budget.defer('core', 60_000)
    await budget.acquire('core')
    expect(clock.time).toBe(90_000)
  })

  it('records retry-specific wait without globally blocking the bucket', () => {
    const events: Parameters<NonNullable<ConstructorParameters<typeof RateBudget>[1]>>[0][] = []
    const clock = virtualClock()
    const budget = new RateBudget(clock, (event) => events.push(event))
    budget.recordRetry('core', 'server_5xx', 1250)
    expect(events).toContainEqual({ bucket: 'core', retryReason: 'server_5xx', retryWaitMs: 1250 })
    expect(budget.pendingGlobalWaitMs('core')).toBe(0)
  })

  it('does not let one rate bucket reservation block another bucket', async () => {
    let now = 0
    let releaseWait: (() => void) | undefined
    const waitStarted = new Promise<void>((resolve) => {
      releaseWait = resolve
    })
    let unblockSleep: (() => void) | undefined
    const budget = new RateBudget({
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds
        await new Promise<void>((resolve) => {
          unblockSleep = resolve
          releaseWait?.()
        })
      },
    })

    await budget.acquire('code_search')
    const blockedCodeSearch = budget.acquire('code_search')
    await waitStarted

    await expect(budget.acquire('graphql')).resolves.toBeUndefined()

    unblockSleep?.()
    await blockedCodeSearch
  })

  it('accounts for each reservation and actual wait without exposing request headers', async () => {
    const clock = virtualClock()
    const events: Array<{ bucket: string; request?: boolean; waitMs?: number; remaining?: number }> = []
    const budget = new RateBudget(clock, (event) => events.push(event))
    await budget.acquire('core')
    await budget.acquire('core')
    budget.observe('core', new Headers({ 'x-ratelimit-remaining': '4998', authorization: 'secret' }))
    expect(events).toEqual([
      { bucket: 'core', request: true },
      { bucket: 'core', waitMs: 750 },
      { bucket: 'core', request: true },
      { bucket: 'core', remaining: 4998 },
    ])
  })
})
