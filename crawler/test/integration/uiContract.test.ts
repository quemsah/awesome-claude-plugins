import { expect, it } from 'vitest'
import { prepareDraft, readDraftSnapshot } from '../../src/publish/publishRun.js'
import { openDatabase } from '../../src/storage/db.js'
import { populateFixture } from '../../src/storage/fixtureDb.js'
import { beginRun, completeRun } from '../../src/storage/runs.js'

it('parses a crawler fixture snapshot with the actual UI schemas', async () => {
  const db = openDatabase(':memory:')
  try {
    populateFixture(db)
    beginRun(db, 'integration', '2026-01-12T00:00:00.000Z')
    completeRun(db, 'integration', '2026-01-12T00:00:00.000Z', 0)
    prepareDraft(db, 'integration', new Date('2026-01-12T00:00:00.000Z'))
    const { reposJson, statsJson } = readDraftSnapshot(db, 'integration')
    const [{ ReposArraySchema }, { StatsArraySchema }] = await Promise.all([
      import('../../../ui/src/schemas/repo.schema.ts'),
      import('../../../ui/src/schemas/stats.schema.ts'),
    ])

    expect(ReposArraySchema.parse(JSON.parse(reposJson))).toHaveLength(2)
    expect(StatsArraySchema.parse(JSON.parse(statsJson))).toHaveLength(3)
  } finally {
    db.close()
  }
})
