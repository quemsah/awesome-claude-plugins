import { describe, expect, it } from 'vitest'
import { getSqliteReader } from '../lib/sqliteCatalogStore.ts'
import { ReposArraySchema } from './repo.schema.ts'
import { StatsArraySchema } from './stats.schema.ts'

describe('checked-in catalog data', () => {
  it('matches the repository schema', () => {
    const reader = getSqliteReader()
    const records = [...reader.iteratePublishedRecords()]
    expect(records.length).toBeGreaterThan(0)
    expect(() => ReposArraySchema.parse(records)).not.toThrow()
  })

  it('matches the statistics schema', () => {
    const reader = getSqliteReader()
    const stats = [...reader.iterateStatistics()]
    expect(stats.length).toBeGreaterThan(0)
    expect(() => StatsArraySchema.parse(stats)).not.toThrow()
  })
})
