import { describe, expect, it } from 'vitest'
import { parseConfig } from './config.js'

const base = { DB_PATH: 'catalog.sqlite', GITHUB_READ_TOKEN: 'read-secret' }

describe('parseConfig', () => {
  it('defaults to a disabled pilot and 24-hour interval', () => {
    expect(parseConfig('crawl', base)).toMatchObject({ publishEnabled: false, intervalHours: 24, readToken: 'read-secret' })
  })

  it('allows overriding the default crawl interval', () => {
    expect(parseConfig('crawl', { ...base, CRAWL_INTERVAL_HOURS: '48' }).intervalHours).toBe(48)
  })

  it.each(['TRUE', '1', 'maybe', ''])('refuses invalid PUBLISH_ENABLED=%j', (value) => {
    expect(() => parseConfig('crawl', { ...base, PUBLISH_ENABLED: value })).toThrow(/configuration/)
  })

  it.each(['0', '-1', 'NaN', '1.5', '72hours', String(Number.MAX_SAFE_INTEGER)])('refuses invalid interval %j', (value) => {
    expect(() => parseConfig('crawl', { ...base, CRAWL_INTERVAL_HOURS: value })).toThrow(/configuration/)
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
})
