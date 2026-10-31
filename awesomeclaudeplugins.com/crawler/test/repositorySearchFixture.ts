import type Database from 'better-sqlite3'
import { historicalWindows, repositorySearchQueries } from '../src/github/repositorySearchQueries.js'
import { ensureRepositorySearchPartition, saveRepositorySearchPartition } from '../src/storage/repositorySearch.js'

/** Existing orchestration tests isolate their original behavior from the initial historical sweep. */
export function completeRepositoryHistory(db: Database.Database) {
  for (const window of historicalWindows('2026-10-30T00:00:00Z')) {
    for (const query of repositorySearchQueries) {
      const partition = ensureRepositorySearchPartition(db, query.queryId, window)
      partition.status = 'complete'
      partition.last_completed_at = '2026-10-30T00:00:00Z'
      saveRepositorySearchPartition(db, partition)
    }
  }
}
