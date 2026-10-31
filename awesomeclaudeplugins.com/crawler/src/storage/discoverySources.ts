import type Database from 'better-sqlite3'
import { repositorySearchQueryVersion } from '../github/repositorySearchQueries.js'
import type { Log } from '../logging.js'
import type { DiscoverySource } from './discoveryCandidates.js'
import { getSetting, runWhileActive, setSetting } from './runs.js'

export type PartitionIdentity = { queryId: string; partitionKey: string }
export type SourceOutcome = {
  state: 'complete' | 'incomplete' | 'not_due'
  incompletePartitions: number
  warnings: string[]
  incompleteRollingPartitions?: number
  incompletePartitionIdentities?: PartitionIdentity[]
}
export type DiscoverySourceSnapshot = {
  lastAttempt?: string
  lastCompleteScan?: string | null
  state?: SourceOutcome['state']
  rollingIncompleteStreak?: number
  incompletePartitions?: number
  warnings?: string[]
  queryVersion?: number
  incompletePartitionIdentities?: PartitionIdentity[]
  repeatedIncompletePartitions?: PartitionIdentity[]
}

export function readDiscoverySource(db: Database.Database, source: DiscoverySource): DiscoverySourceSnapshot {
  const saved = JSON.parse(getSetting(db, `discovery_source_${source}`) ?? '{}') as DiscoverySourceSnapshot
  return source === 'repo_search' && saved.queryVersion !== repositorySearchQueryVersion ? {} : saved
}

/** Persist each source independently, including interrupted attempts before their error propagates. */
export function recordDiscoverySourceOutcome(
  db: Database.Database,
  runId: string,
  source: DiscoverySource,
  outcome: SourceOutcome,
  at: string,
  log?: Log,
): void {
  const previous = readDiscoverySource(db, source)
  const streak = (outcome.incompleteRollingPartitions ?? 0) > 0 ? (previous.rollingIncompleteStreak ?? 0) + 1 : 0
  const identities = outcome.incompletePartitionIdentities ?? []
  const previousKeys = new Set(
    (previous.incompletePartitionIdentities ?? []).map(({ queryId, partitionKey }) => `${queryId}/${partitionKey}`),
  )
  // Rolling windows move every day and use the source-level streak; stable historical leaves retain their identities.
  const repeated = identities.filter(
    ({ queryId, partitionKey }) => partitionKey.startsWith('created:') && previousKeys.has(`${queryId}/${partitionKey}`),
  )
  runWhileActive(db, runId, () =>
    setSetting(
      db,
      `discovery_source_${source}`,
      JSON.stringify({
        lastAttempt: at,
        state: outcome.state,
        queryVersion: source === 'repo_search' ? repositorySearchQueryVersion : undefined,
        incompletePartitions: outcome.incompletePartitions,
        warnings: outcome.warnings,
        lastCompleteScan: outcome.state === 'complete' ? at : (previous.lastCompleteScan ?? null),
        rollingIncompleteStreak: streak,
        incompletePartitionIdentities: identities,
        repeatedIncompletePartitions: repeated,
      }),
    ),
  )
  if (outcome.state === 'incomplete')
    log?.({
      level: 'warn',
      event: 'crawl.coverage_warning',
      phase: 'discovery',
      category: 'source_incomplete',
      runId,
      source,
      incompletePartitions: outcome.incompletePartitions,
      warnings: outcome.warnings,
      coverageScope: 'configured_query_catalog',
    })
  if (streak >= 2)
    log?.({
      level: 'warn',
      event: 'crawl.coverage_alert',
      phase: 'discovery',
      category: 'rolling_partition_repeatedly_incomplete',
      runId,
      source,
      consecutiveCrawls: streak,
      incompleteRollingPartitions: outcome.incompleteRollingPartitions,
    })
  if (repeated.length)
    log?.({
      level: 'warn',
      event: 'crawl.coverage_alert',
      phase: 'discovery',
      category: 'partition_repeatedly_incomplete',
      runId,
      source,
      queryVersion: repositorySearchQueryVersion,
      partitions: repeated,
    })
}
