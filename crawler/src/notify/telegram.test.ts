import { describe, expect, it } from 'vitest'
import { TelegramNotificationError, TelegramNotifier, type TelegramSummary } from './telegram.js'

const token = '12345:private-bot-secret'
const summary: TelegramSummary = {
  runId: 'run-17',
  catalogSize: 40959,
  newCount: 3,
  deletedCount: 1,
  skippedCount: 2,
  problematicRanges: ['size:0..100', 'size:101..200'],
}

function harness(responses: Array<Response | Error>) {
  let time = 0
  const requests: Array<{ url: string; init: RequestInit | undefined; time: number }> = []
  const notifier = new TelegramNotifier({
    botToken: token,
    chatId: '-100123456789',
    clock: {
      now: () => time,
      sleep: async (milliseconds) => {
        time += milliseconds
      },
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input).replaceAll(token, '[REDACTED]'), init, time })
      const response = responses.shift()
      if (!response) throw new Error('Unexpected fetch')
      if (response instanceof Error) throw response
      return response
    }) as typeof fetch,
  })
  return { notifier, requests }
}

function body(request: { init: RequestInit | undefined }): { chat_id: string; text: string } {
  return JSON.parse(String(request.init?.body)) as { chat_id: string; text: string }
}

describe('TelegramNotifier', () => {
  it('reports a completed dry-run without implying publication or including a pending SHA', async () => {
    const test = harness([Response.json({ ok: true })])
    const unconfirmed = { ...summary, confirmedGitSha: 'unconfirmed-sha' }
    await test.notifier.notifyDryRun(unconfirmed)
    expect(body(test.requests[0]).text).toContain('Dry run completed')
    expect(body(test.requests[0]).text).not.toMatch(/SHA|unconfirmed-sha|Publication succeeded/)
  })
  it('includes total crawl duration in the completion report', async () => {
    const test = harness([Response.json({ ok: true })])
    await test.notifier.notifyDryRun({ ...summary, durationMs: 3_661_000 })
    expect(body(test.requests[0]).text).toContain('duration: 1h 1m 1s')
  })
  it('sends a start summary as plain text over POST with a deadline and no published SHA', async () => {
    const test = harness([Response.json({ ok: true, result: { message_id: 1 } })])
    const accidentalSha = { ...summary, confirmedGitSha: 'accidental-unconfirmed-sha' }
    await test.notifier.notifyStart(accidentalSha)

    expect(test.requests).toHaveLength(1)
    const [request] = test.requests
    expect(request.url).toBe('https://api.telegram.org/bot[REDACTED]/sendMessage')
    expect(request.init?.method).toBe('POST')
    expect(request.init?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(request.init?.signal).toBeInstanceOf(AbortSignal)
    expect(body(request)).toEqual({
      chat_id: '-100123456789',
      text: 'Crawl started\nrun_id: run-17\ncatalog size: 40959\nnew: 3\ndeleted: 1\nskipped: 2\nproblematic size ranges: size:0..100, size:101..200',
    })
    expect(request.init).not.toHaveProperty('parse_mode')
  })

  it('reports a failure reason without implying an unpublished SHA was published', async () => {
    const test = harness([Response.json({ ok: true })])
    const pendingSha = { ...summary, reason: 'no_successful_ranges', confirmedGitSha: 'pending-sha' }
    await test.notifier.notifyFailure(pendingSha)

    expect(body(test.requests[0]).text).toBe(
      'Crawl failed\nrun_id: run-17\ncatalog size: 40959\nnew: 3\ndeleted: 1\nskipped: 2\nproblematic size ranges: size:0..100, size:101..200\nreason: no_successful_ranges',
    )
    expect(test.requests[0].init?.body).not.toContain('pending-sha')
  })

  it('rejects a failure reason containing credentials before contacting Telegram', async () => {
    const test = harness([])
    const secretReason = 'Authorization: private-bot-secret'
    await expect(test.notifier.notifyFailure({ ...summary, reason: secretReason })).rejects.toMatchObject({
      category: 'configuration',
      message: expect.not.stringContaining('private-bot-secret'),
    })
    expect(test.requests).toHaveLength(0)
  })

  it('accepts a short GitHub failure category unchanged', async () => {
    const test = harness([Response.json({ ok: true })])
    await test.notifier.notifyFailure({ ...summary, reason: 'github_fatal_error' })
    expect(body(test.requests[0]).text).toContain('\nreason: github_fatal_error')
  })

  it.each(['', 'UPPERCASE', 'invalid reason', 'a'.repeat(65)])('rejects invalid failure category %j before fetch', async (reason) => {
    const test = harness([])
    await expect(test.notifier.notifyFailure({ ...summary, reason })).rejects.toMatchObject({ category: 'configuration' })
    expect(test.requests).toHaveLength(0)
  })

  it('includes the confirmed Git SHA only in the successful publication summary', async () => {
    const test = harness([Response.json({ ok: true })])
    await test.notifier.notifySuccess({ ...summary, confirmedGitSha: 'a'.repeat(40) })

    expect(body(test.requests[0]).text).toBe(
      `Publication succeeded\nrun_id: run-17\ncatalog size: 40959\nnew: 3\ndeleted: 1\nskipped: 2\nproblematic size ranges: size:0..100, size:101..200\nconfirmed Git SHA: ${'a'.repeat(40)}`,
    )
  })

  it('reports all saturated range count but bounds a worst-case 220-range message below Telegram limit', async () => {
    const test = harness([Response.json({ ok: true })])
    const ranges = Array.from({ length: 220 }, (_, index) => `size:${index * 10_000}..${index * 10_000 + 9_999}`)
    await test.notifier.notifySuccess({
      ...summary,
      problematicRanges: [...ranges, ...ranges],
      confirmedGitSha: 'a'.repeat(40),
    })

    const message = body(test.requests[0]).text
    expect(message.length).toBeLessThanOrEqual(4096)
    expect(message).toContain('220 problematic size ranges')
    expect(message).toContain('size:0..9999')
    expect(message).toMatch(/\(\+\d+ more ranges\)/)
    expect(message).toContain(`confirmed Git SHA: ${'a'.repeat(40)}`)
  })

  it('includes separate enrichment outcomes, error categories and GitHub requests without exceeding the message limit', async () => {
    const test = harness([Response.json({ ok: true })])
    await test.notifier.notifyDryRun({
      ...summary,
      problematicRanges: Array.from({ length: 220 }, (_, index) => `size:${index * 10000}..${index * 10000 + 9999}`),
      enrichment: {
        updated: 23,
        unchangedOnError: 2,
        newReady: 3,
        newIncomplete: 1,
        deleted404: 4,
        deletedBlankUrl: 5,
        conclusive: 30,
        warnings: 2,
      },
      errorCategories: { marketplace_rate_limited: 2, repository_identity_mismatch: 1 },
      rateBuckets: {
        code_search: { requests: 221, waitMs: 6000, lastRemaining: 7 },
        core: { requests: 81000, waitMs: 180000, lastRemaining: 200 },
      },
    })
    const message = body(test.requests[0]).text
    expect(message).toContain('updated: 23')
    expect(message).toContain('new incomplete: 1')
    expect(message).toContain('deleted 404: 4')
    expect(message).toContain('marketplace_rate_limited: 2')
    expect(message).toContain('code_search requests: 221')
    expect(message).toContain('core requests: 81000')
    expect(message.length).toBeLessThanOrEqual(4096)
  })

  it('requires bot credentials and a confirmed SHA without exposing the token', async () => {
    expect(() => new TelegramNotifier({ botToken: token, chatId: '' })).toThrow(
      expect.objectContaining({ category: 'configuration', message: expect.not.stringContaining(token) }),
    )
    expect(() => new TelegramNotifier({ botToken: '', chatId: '123' })).toThrow(expect.objectContaining({ category: 'configuration' }))
    const test = harness([])
    await expect(test.notifier.notifySuccess({ ...summary, confirmedGitSha: 'pending' })).rejects.toMatchObject({
      category: 'configuration',
    })
    expect(test.requests).toHaveLength(0)
  })

  it('honors JSON retry_after on a 429 before trying again', async () => {
    const test = harness([Response.json({ ok: false, parameters: { retry_after: 7 } }, { status: 429 }), Response.json({ ok: true })])
    await test.notifier.notifyStart(summary)
    expect(test.requests.map((request) => request.time)).toEqual([0, 7000])
  })

  it('honors the Retry-After header when a 429 body is not JSON', async () => {
    const test = harness([new Response('not JSON', { status: 429, headers: { 'Retry-After': '4' } }), Response.json({ ok: true })])
    await test.notifier.notifyStart(summary)
    expect(test.requests.map((request) => request.time)).toEqual([0, 4000])
  })

  it('does not retry an aborted 429 response body read', async () => {
    const response = Response.json({ ok: false }, { status: 429 })
    response.json = async () => {
      throw new DOMException('body read aborted', 'AbortError')
    }
    const test = harness([response])
    await expect(test.notifier.notifyStart(summary)).rejects.toMatchObject({ category: 'timeout', status: 429 })
    expect(test.requests).toHaveLength(1)
  })

  it('stops after three rate-limited attempts rather than silently dropping the notification', async () => {
    const test = harness(Array.from({ length: 3 }, () => Response.json({ ok: false, parameters: { retry_after: 2 } }, { status: 429 })))
    await expect(test.notifier.notifyStart(summary)).rejects.toMatchObject({ category: 'rate_limited', status: 429 })
    expect(test.requests.map((request) => request.time)).toEqual([0, 2000, 4000])
  })

  it('uses bounded backoff for 503 and network errors', async () => {
    const test = harness([
      new Error(`request https://api.telegram.org/bot${token}/sendMessage failed`),
      new Response('', { status: 503 }),
      Response.json({ ok: true }),
    ])
    await test.notifier.notifyStart(summary)
    expect(test.requests.map((request) => request.time)).toEqual([0, 1000, 3000])
  })

  it('surfaces a safe server error after three 503 responses', async () => {
    const test = harness(Array.from({ length: 3 }, () => new Response('', { status: 503 })))
    await expect(test.notifier.notifyStart(summary)).rejects.toMatchObject({ category: 'server_error', status: 503 })
    expect(test.requests).toHaveLength(3)
  })

  it.each([401, 403])('fails immediately on HTTP %i authorization/permission errors', async (status) => {
    const test = harness([Response.json({ ok: false, description: token }, { status })])
    await expect(test.notifier.notifyStart(summary)).rejects.toMatchObject({ category: 'authorization', status })
    expect(test.requests).toHaveLength(1)
  })

  it('rejects other non-200 HTTP responses even if their JSON falsely acknowledges success', async () => {
    const test = harness([Response.json({ ok: true }, { status: 400 })])
    await expect(test.notifier.notifyStart(summary)).rejects.toMatchObject({ category: 'http_error', status: 400 })
    expect(test.requests).toHaveLength(1)
  })

  it('rejects a malformed JSON success response', async () => {
    const test = harness([new Response('not JSON', { status: 200 })])
    await expect(test.notifier.notifyStart(summary)).rejects.toMatchObject({ category: 'invalid_response', status: 200 })
    expect(test.requests).toHaveLength(1)
  })

  it('classifies an aborted JSON body read as timeout, not malformed JSON', async () => {
    const response = Response.json({ ok: true })
    response.json = async () => {
      throw new DOMException('body read aborted', 'AbortError')
    }
    const test = harness([response])
    await expect(test.notifier.notifyStart(summary)).rejects.toMatchObject({ category: 'timeout', status: 200 })
    expect(test.requests).toHaveLength(1)
  })

  it('rejects Telegram negative acknowledgements even when HTTP is 200', async () => {
    const test = harness([Response.json({ ok: false, description: token })])
    await expect(test.notifier.notifyStart(summary)).rejects.toMatchObject({ category: 'rejected', status: 200 })
    expect(test.requests).toHaveLength(1)
  })

  it('never copies a transport error or Telegram description containing the token into its errors', async () => {
    const test = harness([
      ...Array.from({ length: 3 }, () => new Error(`request failed for https://api.telegram.org/bot${token}/sendMessage`)),
      Response.json({ ok: false, description: token }),
    ])
    let networkError: unknown
    try {
      await test.notifier.notifyStart(summary)
    } catch (error) {
      networkError = error
    }
    expect(networkError).toBeInstanceOf(TelegramNotificationError)
    expect(networkError).toMatchObject({ category: 'network_error', status: null })
    expect(JSON.stringify(networkError)).not.toContain(token)
    expect(String(networkError)).not.toContain(token)

    await expect(test.notifier.notifyStart(summary)).rejects.toMatchObject({ category: 'rejected' })
    expect(test.requests).toHaveLength(4)
    expect(test.requests.map((request) => request.url).join(' ')).not.toContain(token)
  })
})
