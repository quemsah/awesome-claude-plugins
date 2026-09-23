import type { EnrichmentCounts } from '../crawl/enrich.js'
import type { GitHubRateBuckets } from '../github/rateBudget.js'

export type TelegramSummary = {
  runId: string
  catalogSize: number
  newCount: number
  deletedCount: number
  skippedCount: number
  problematicRanges: readonly string[]
  enrichment?: EnrichmentCounts
  errorCategories?: Record<string, number>
  rateBuckets?: GitHubRateBuckets
  durationMs?: number
}

export type TelegramNotificationCategory =
  | 'configuration'
  | 'rate_limited'
  | 'server_error'
  | 'network_error'
  | 'authorization'
  | 'http_error'
  | 'invalid_response'
  | 'rejected'
  | 'timeout'

export class TelegramNotificationError extends Error {
  constructor(
    readonly category: TelegramNotificationCategory,
    readonly status: number | null = null,
  ) {
    super(`Telegram notification failed: ${category}`)
    this.name = 'TelegramNotificationError'
  }
}

export type TelegramClock = {
  now: () => number
  sleep: (milliseconds: number) => Promise<void>
}

export type TelegramOptions = {
  botToken: string
  chatId: string
  fetch?: typeof fetch
  clock?: TelegramClock
}

const defaultClock: TelegramClock = {
  now: Date.now,
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}

const maxAttempts = 3
const deadlineMs = 30_000
const maxRetryDelayMs = 120_000
const shaPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i
const failureCategoryPattern = /^[a-z][a-z0-9_-]{0,63}$/

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

function retryAfterHeader(headers: Headers, now: number): number | null {
  const raw = headers.get('Retry-After')
  if (raw === null) return null
  const seconds = Number(raw)
  if (raw.trim() !== '' && Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000)
  const date = Date.parse(raw)
  return Number.isNaN(date) ? null : Math.max(0, date - now)
}

function retryAfterJson(value: unknown): number | null {
  if (!record(value) || !record(value.parameters)) return null
  const seconds = value.parameters.retry_after
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : null
}

function summaryText(summary: TelegramSummary): string {
  const details = summary.enrichment
    ? [
        `updated: ${summary.enrichment.updated}`,
        `unchanged on error: ${summary.enrichment.unchangedOnError}`,
        `new ready: ${summary.enrichment.newReady}`,
        `new incomplete: ${summary.enrichment.newIncomplete}`,
        `deleted 404: ${summary.enrichment.deleted404}`,
        `deleted blank URL: ${summary.enrichment.deletedBlankUrl}`,
      ]
    : []
  if (summary.errorCategories) {
    const categories = Object.entries(summary.errorCategories).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    details.push(
      `error categories: ${
        categories
          .slice(0, 5)
          .map(([name, count]) => `${name}: ${count}`)
          .join(', ') || 'none'
      }`,
    )
    if (categories.length > 5) details.push(`${categories.length - 5} more error categories in run_errors`)
  }
  if (summary.rateBuckets) {
    for (const bucket of ['code_search', 'core'] as const) {
      details.push(`${bucket} requests: ${summary.rateBuckets[bucket].requests}; wait ms: ${summary.rateBuckets[bucket].waitMs}`)
    }
  }
  if (summary.durationMs !== undefined) {
    const seconds = Math.floor(summary.durationMs / 1000)
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    details.push(`duration: ${hours}h ${minutes}m ${seconds % 60}s`)
  }
  const lines = [
    `run_id: ${summary.runId}`,
    `catalog size: ${summary.catalogSize}`,
    `new: ${summary.newCount}`,
    `deleted: ${summary.deletedCount}`,
    `skipped: ${summary.skippedCount}`,
    ...details,
  ]
  const ranges = [...new Set(summary.problematicRanges)]
  const shown: string[] = []
  let length = 0
  const budget = Math.max(0, 3800 - lines.join('\n').length)
  for (const range of ranges) {
    const next = length + range.length + (shown.length ? 2 : 0)
    if (next > budget) break
    shown.push(range)
    length = next
  }
  const omitted = ranges.length - shown.length
  const rangeList = `${shown.join(', ') || 'none'}${omitted ? ` (+${omitted} more ranges); ${ranges.length} problematic size ranges total` : ''}`
  return [...lines, `problematic size ranges: ${rangeList}`].join('\n')
}

/** On delivery failure, callers log { level: 'error', phase: 'notify', category, status }; they must not roll back the confirmed Git commit. */
export class TelegramNotifier {
  readonly #botToken: string
  readonly #chatId: string
  readonly #transport: typeof fetch
  readonly #clock: TelegramClock

  constructor(options: TelegramOptions) {
    if (typeof options?.botToken !== 'string' || !options.botToken.trim() || typeof options.chatId !== 'string' || !options.chatId.trim()) {
      throw new TelegramNotificationError('configuration')
    }
    this.#botToken = options.botToken
    this.#chatId = options.chatId
    this.#transport = options.fetch ?? globalThis.fetch
    this.#clock = options.clock ?? defaultClock
  }

  notifyStart(summary: TelegramSummary): Promise<void> {
    return this.send(`Crawl started\n${summaryText(summary)}`)
  }

  notifyDryRun(summary: TelegramSummary): Promise<void> {
    return this.send(`Dry run completed (draft prepared; not published)\n${summaryText(summary)}`)
  }

  notifyFailure(summary: TelegramSummary & { reason: string }): Promise<void> {
    if (typeof summary?.reason !== 'string' || !failureCategoryPattern.test(summary.reason)) {
      return Promise.reject(new TelegramNotificationError('configuration'))
    }
    return this.send(`Crawl failed\n${summaryText(summary)}\nreason: ${summary.reason}`)
  }

  notifySuccess(summary: TelegramSummary & { confirmedGitSha: string }): Promise<void> {
    if (!shaPattern.test(summary.confirmedGitSha)) return Promise.reject(new TelegramNotificationError('configuration'))
    return this.send(`Publication succeeded\n${summaryText(summary)}\nconfirmed Git SHA: ${summary.confirmedGitSha}`)
  }

  private async send(text: string): Promise<void> {
    if (text.length > 4096) throw new TelegramNotificationError('configuration')
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let response: Response
      try {
        response = await this.#transport(`https://api.telegram.org/bot${this.#botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: this.#chatId, text }),
          signal: AbortSignal.timeout(deadlineMs),
        })
      } catch (error) {
        if (isAbort(error)) {
          throw new TelegramNotificationError('timeout')
        }
        if (attempt === maxAttempts - 1) throw new TelegramNotificationError('network_error')
        await this.#clock.sleep(1000 * 2 ** attempt)
        continue
      }

      const status = response.status
      if (status === 401 || status === 403) throw new TelegramNotificationError('authorization', status)
      if (status === 429) {
        let payload: unknown
        try {
          payload = await response.json()
        } catch (error) {
          if (isAbort(error)) throw new TelegramNotificationError('timeout', status)
          // Retry-After may still be present on a non-JSON rate-limit response.
        }
        if (attempt === maxAttempts - 1) throw new TelegramNotificationError('rate_limited', status)
        const delay = Math.max(retryAfterJson(payload) ?? 0, retryAfterHeader(response.headers, this.#clock.now()) ?? 0, 1000)
        if (delay > maxRetryDelayMs) throw new TelegramNotificationError('rate_limited', status)
        await this.#clock.sleep(delay)
        continue
      }
      if (status >= 500) {
        if (attempt === maxAttempts - 1) throw new TelegramNotificationError('server_error', status)
        await this.#clock.sleep(1000 * 2 ** attempt)
        continue
      }
      if (!response.ok || status !== 200) throw new TelegramNotificationError('http_error', status)

      let payload: unknown
      try {
        payload = await response.json()
      } catch (error) {
        if (isAbort(error)) throw new TelegramNotificationError('timeout', status)
        throw new TelegramNotificationError('invalid_response', status)
      }
      if (!record(payload) || typeof payload.ok !== 'boolean') throw new TelegramNotificationError('invalid_response', status)
      if (!payload.ok) throw new TelegramNotificationError('rejected', status)
      return
    }
  }
}
