import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { beginRun, claimPublicationLease, completeRun, saveRunDraft, setSetting } from '../storage/runs.js'
import { initializeSchema } from '../storage/schema.js'
import { crawlSchedule, ScheduleError } from './schedule.js'

function database() {
  const db = new Database(':memory:')
  initializeSchema(db)
  return db
}

describe('crawlSchedule', () => {
  it('checks the last published time, not the last dry-run, at the 72-hour boundary', () => {
    const db = database()
    setSetting(db, 'last_published_at', '2026-09-20T12:00:00.000Z')
    expect(crawlSchedule(db, new Date('2026-09-23T11:59:59.999Z'), 72, false)).toBe('not-due')
    expect(crawlSchedule(db, new Date('2026-09-23T12:00:00.000Z'), 72, false)).toBe('due')
    expect(crawlSchedule(db, new Date('2026-09-21T12:00:00.000Z'), 72, true)).toBe('due')
    db.close()
  })

  it('force never bypasses the active-run lock, regardless of heartbeat age', () => {
    const db = database()
    beginRun(db, 'still-working', '2020-01-01T00:00:00.000Z')
    expect(() => crawlSchedule(db, new Date('2026-09-23T12:00:00.000Z'), 72, true)).toThrow(ScheduleError)
    db.close()
  })

  it('refuses a new scheduled or forced crawl until an interrupted Git publication is reconciled', () => {
    const db = database()
    beginRun(db, 'pending', '2026-09-20T00:00:00.000Z')
    completeRun(db, 'pending', '2026-09-20T01:00:00.000Z', 0)
    saveRunDraft(db, 'pending', { id: 1, date: '2026-09-20T01:00:00.000Z', size: 1, hash: 'a'.repeat(64) })
    claimPublicationLease(db, 'pending', 'owner')
    expect(() => crawlSchedule(db, new Date('2026-09-23T12:00:00.000Z'), 72, false)).toThrowError(
      expect.objectContaining({ category: 'publication_locked' }),
    )
    expect(() => crawlSchedule(db, new Date('2026-09-23T12:00:00.000Z'), 72, true)).toThrowError(
      expect.objectContaining({ category: 'publication_locked' }),
    )
    db.close()
  })

  it('refuses invalid publication settings', () => {
    const db = new Database(':memory:')
    initializeSchema(db)
    expect(crawlSchedule(db, new Date(), 72, false)).toBe('due')
    setSetting(db, 'last_published_at', 'not-a-date')
    expect(() => crawlSchedule(db, new Date(), 72, false)).toThrow(/invalid/)
    db.close()
  })
})
