import { describe, expect, it } from 'vitest'
import { parseConfig } from './config.js'

const base = { DB_PATH: 'catalog.sqlite', GITHUB_READ_TOKEN: 'read-secret' }

describe('parseConfig', () => {
  it('defaults to a disabled pilot', () => {
    expect(parseConfig('crawl', base)).toMatchObject({ publishEnabled: false, repositorySearchEnabled: false, readToken: 'read-secret' })
  })

  it.each(['TRUE', '1', 'maybe', ''])('refuses invalid PUBLISH_ENABLED=%j', (value) => {
    expect(() => parseConfig('crawl', { ...base, PUBLISH_ENABLED: value })).toThrow(/configuration/)
  })

  it('requires an explicit repository-search opt-in', () => {
    expect(parseConfig('crawl', { ...base, REPOSITORY_SEARCH_ENABLED: 'true' }).repositorySearchEnabled).toBe(true)
    for (const value of ['TRUE', '1', 'yes', '']) {
      expect(() => parseConfig('crawl', { ...base, REPOSITORY_SEARCH_ENABLED: value })).toThrow(/configuration/)
    }
  })

  it('requires both Telegram credentials for production and refuses partial credentials in pilot', () => {
    expect(() => parseConfig('crawl', { ...base, PUBLISH_ENABLED: 'true' })).toThrow(/configuration/)
    expect(() => parseConfig('crawl', { ...base, TELEGRAM_CHAT_ID: 'chat' })).toThrow(/configuration/)
  })

  it('requires explicit repository, branch and separate write token before publication', () => {
    const env = { ...base, PUBLISH_ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'bot', TELEGRAM_CHAT_ID: 'chat' }
    expect(() => parseConfig('publish', env)).toThrow(/configuration/)
    expect(
      parseConfig('publish', { ...env, GITHUB_REPOSITORY: 'owner/repo', GITHUB_BRANCH: 'main', GITHUB_PUBLISH_TOKEN: 'write' }),
    ).toMatchObject({
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      publishToken: 'write',
    })
    expect(() =>
      parseConfig('publish', { ...env, GITHUB_REPOSITORY: 'owner/repo', GITHUB_BRANCH: 'main', GITHUB_PUBLISH_TOKEN: 'read-secret' }),
    ).toThrow(/configuration/)
    expect(() => parseConfig('publish', { ...env, GITHUB_REPOSITORY: 'owner/repo', GITHUB_BRANCH: 'main' })).toThrow(/configuration/)
  })

  it('configures repository search request budget with default 120 and accepts valid positive integers', () => {
    expect(parseConfig('crawl', base).repositorySearchMaxRequests).toBe(120)
    expect(parseConfig('crawl', { ...base, REPOSITORY_SEARCH_MAX_REQUESTS: '50' }).repositorySearchMaxRequests).toBe(50)
    for (const invalid of ['0', '-10', 'abc', '12.5']) {
      expect(() => parseConfig('crawl', { ...base, REPOSITORY_SEARCH_MAX_REQUESTS: invalid })).toThrow(/configuration/)
    }
  })

  it('allows read-only enrichment backfill in a publishing environment without publishing credentials', () => {
    expect(parseConfig('backfill-enrichment', {
      ...base,
      PUBLISH_ENABLED: 'true',
      REPOSITORY_SEARCH_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: 'configured-bot',
    })).toMatchObject({
      publishEnabled: false,
      readToken: 'read-secret',
      botToken: undefined,
      repositorySearchEnabled: true,
    })
    expect(() => parseConfig('backfill-enrichment', { DB_PATH: 'catalog.sqlite' })).toThrow(/configuration/)
  })

  it('configures enrichment pending candidates cap with default 3000 and accepts valid positive integers', () => {
    expect(parseConfig('crawl', base).enrichmentMaxPendingCandidates).toBe(3000)
    expect(parseConfig('crawl', { ...base, ENRICHMENT_MAX_PENDING_CANDIDATES: '500' }).enrichmentMaxPendingCandidates).toBe(500)
    for (const invalid of ['0', '-5', 'foo', '1.5']) {
      expect(() => parseConfig('crawl', { ...base, ENRICHMENT_MAX_PENDING_CANDIDATES: invalid })).toThrow(/configuration/)
    }
  })

  it('configures gap reconciliation flag with default false and accepts boolean values', () => {
    expect(parseConfig('crawl', base).reconcileExpiredGaps).toBe(false)
    expect(parseConfig('crawl', { ...base, RECONCILE_EXPIRED_GAPS: 'true' }).reconcileExpiredGaps).toBe(true)
    expect(parseConfig('crawl', { ...base, RECONCILE_EXPIRED_GAPS: 'false' }).reconcileExpiredGaps).toBe(false)
    for (const invalid of ['1', 'yes', 'TRUE']) {
      expect(() => parseConfig('crawl', { ...base, RECONCILE_EXPIRED_GAPS: invalid })).toThrow(/configuration/)
    }
  })
})
