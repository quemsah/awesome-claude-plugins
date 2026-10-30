import { describe, expect, it } from 'vitest'
import reposData from '../data/repos.json' with { type: 'json' }
import statsData from '../data/stats.json' with { type: 'json' }
import { ReposArraySchema } from './repo.schema.ts'
import { StatsArraySchema } from './stats.schema.ts'

describe('checked-in catalog data', () => {
  it('matches the repository schema', () => {
    expect(() => ReposArraySchema.parse(reposData)).not.toThrow()
  })

  it('matches the statistics schema', () => {
    expect(() => StatsArraySchema.parse(statsData)).not.toThrow()
  })
})
