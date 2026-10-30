import { expect, it } from 'vitest'
import { prepareDraft, readDraftSnapshot } from '../../src/publish/publishRun.js'
import { openDatabase } from '../../src/storage/db.js'
import { populateFixture } from '../../src/storage/fixtureDb.js'
import { beginRun, completeRun } from '../../src/storage/runs.js'

it('validates crawler snapshots with the shared catalog and UI stats schemas', async () => {
  const db = openDatabase(':memory:')
  try {
    populateFixture(db)
    beginRun(db, 'integration', '2026-01-12T00:00:00.000Z')
    completeRun(db, 'integration', '2026-01-12T00:00:00.000Z', 0)
    prepareDraft(db, 'integration', new Date('2026-01-12T00:00:00.000Z'))
    const { reposJson, statsJson } = readDraftSnapshot(db, 'integration')
    const [{ PublishedReposArraySchema, ReposArraySchema }, { StatsArraySchema }] = await Promise.all([
      import('@awesome-claude-plugins/catalog-contract'),
      import('../../../ui/src/schemas/stats.schema.ts'),
    ])

    const published = JSON.parse(reposJson)
    expect(PublishedReposArraySchema.parse(published)).toHaveLength(2)
    expect(ReposArraySchema.parse(published)).toHaveLength(2)
    // Previously published URLs must not be reintroduced by the shared package.
    expect(published[0]).not.toHaveProperty('html_url')
    expect(published[0]).not.toHaveProperty('owner_url')
    expect(published[0]).toHaveProperty('catalog_updated_at')
    expect(StatsArraySchema.parse(JSON.parse(statsJson))).toHaveLength(3)
  } finally {
    db.close()
  }
})
