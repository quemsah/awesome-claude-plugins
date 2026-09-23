import type Database from 'better-sqlite3'
import { getActiveRun, getPublicationLease, getSetting } from '../storage/runs.js'

export class ScheduleError extends Error {
  constructor(readonly category: 'active_run' | 'publication_locked' | 'invalid_publication_time') {
    super(`Crawl schedule: ${category}`)
    this.name = 'ScheduleError'
  }
}

export function crawlSchedule(db: Database.Database, now: Date, intervalHours: number, force: boolean): 'due' | 'not-due' {
  if (getActiveRun(db)) throw new ScheduleError('active_run')
  if (getPublicationLease(db)) throw new ScheduleError('publication_locked')
  const previous = getSetting(db, 'last_published_at')
  if (previous === null) return 'due'
  const time = Date.parse(previous)
  if (!Number.isFinite(time) || new Date(time).toISOString() !== previous) throw new ScheduleError('invalid_publication_time')
  return force || now.getTime() - time >= intervalHours * 3_600_000 ? 'due' : 'not-due'
}
