import type Database from 'better-sqlite3'

export const RUN_DIAGNOSTIC_RETENTION_DAYS = 90

const DAY_MS = 24 * 60 * 60 * 1000

export type MaintenanceResult = {
  cutoff: string
  retentionDays: number
  runsDeleted: number
  errorsDeleted: number
  settingsDeleted: number
  statsDetached: number
  walCheckpoint: {
    busy: number
    log: number
    checkpointed: number
  }
}

type RunIdRow = { run_id: string }
type WalCheckpointRow = { busy: number; log: number; checkpointed: number }

export function optimizeDatabase(db: Database.Database): void {
  db.pragma('optimize')
}

export function runMaintenance(
  db: Database.Database,
  now: Date = new Date(),
  retentionDays = RUN_DIAGNOSTIC_RETENTION_DAYS,
): MaintenanceResult {
  if (!Number.isInteger(retentionDays) || retentionDays <= 0) throw new Error('retentionDays must be a positive integer')
  if (Number.isNaN(now.getTime())) throw new Error('now must be a valid date')

  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS).toISOString()
  const selectCandidates = db.prepare(`
    SELECT runs.run_id
    FROM runs
    LEFT JOIN publication_lease ON publication_lease.run_id = runs.run_id
    WHERE runs.status IN ('completed', 'failed', 'published')
      AND runs.completed_at IS NOT NULL
      AND runs.completed_at < ?
      AND publication_lease.run_id IS NULL
    ORDER BY runs.completed_at, runs.run_id
  `)
  const detachStats = db.prepare('UPDATE stats SET run_id = NULL WHERE run_id = ?')
  const deleteErrors = db.prepare('DELETE FROM run_errors WHERE run_id = ?')
  const deleteSettings = db.prepare('DELETE FROM settings WHERE key IN (?, ?, ?)')
  const deleteRun = db.prepare('DELETE FROM runs WHERE run_id = ?')

  const counts = db
    .transaction(() => {
      const candidates = selectCandidates.all(cutoff) as RunIdRow[]
      let runsDeleted = 0
      let errorsDeleted = 0
      let settingsDeleted = 0
      let statsDetached = 0

      for (const { run_id: runId } of candidates) {
        statsDetached += detachStats.run(runId).changes
        errorsDeleted += deleteErrors.run(runId).changes
        settingsDeleted += deleteSettings.run(
          `run_report_${runId}`,
          `schedule_alert_active_run_${runId}`,
          `schedule_alert_publication_locked_${runId}`,
        ).changes
        runsDeleted += deleteRun.run(runId).changes
      }

      return { runsDeleted, errorsDeleted, settingsDeleted, statsDetached }
    })
    .immediate()

  const walCheckpoint = (db.pragma('wal_checkpoint(PASSIVE)') as WalCheckpointRow[])[0] ?? { busy: 0, log: 0, checkpointed: 0 }

  return {
    cutoff,
    retentionDays,
    ...counts,
    walCheckpoint,
  }
}
