import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { renderRepos, renderStats } from '../../src/output/catalogSnapshot.js'
import { validateSnapshot } from '../../src/output/validate.js'
import { openDatabase } from '../../src/storage/db.js'
import { importCsv } from '../../src/storage/importCsv.js'

const root = join(import.meta.dirname, '../../..')
const installed = existsSync(join(root, 'ui/node_modules/zod')) && existsSync(join(root, 'crawler/node_modules/better-sqlite3'))
const enabled = installed || process.env.REQUIRE_UI_CONTRACT === '1'
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

it.skipIf(!enabled)('parses imported fixture snapshots with the actual UI repo and stats schemas', async () => {
  const { ReposArraySchema } = await import('../../../ui/src/schemas/repo.schema.ts')
  const { StatsArraySchema } = await import('../../../ui/src/schemas/stats.schema.ts')
  const db = openDatabase(':memory:')
  try {
    await importCsv(db, {
      reposPath: join(root, 'crawler/test/fixtures/repos.csv'),
      statsPath: join(root, 'crawler/test/fixtures/stats.csv'),
    })
    const reposJson = renderRepos(db)
    const statsJson = renderStats(db)
    validateSnapshot(reposJson, statsJson, { expectedSize: 2 })
    const repos = ReposArraySchema.parse(JSON.parse(reposJson))
    const stats = StatsArraySchema.parse(JSON.parse(statsJson))
    expect(repos.map(({ id }) => id)).toEqual([1, 3])
    expect(stats.map(({ id }) => id)).toEqual([2, 7])
  } finally {
    db.close()
  }
})

it.skipIf(!enabled || process.env.CATALOG_REAL_CSV !== '1')(
  'preserves the imported historical catalog fingerprints without any network or Git writes',
  async () => {
    const { ReposArraySchema } = await import('../../../ui/src/schemas/repo.schema.ts')
    const { StatsArraySchema } = await import('../../../ui/src/schemas/stats.schema.ts')
    const db = openDatabase(':memory:')
    try {
      await importCsv(db, {
        reposPath: join(root, 'n8n/c2-claude-plugins.csv'),
        statsPath: join(root, 'n8n/c2-stats.csv'),
      })
      const reposJson = renderRepos(db)
      const statsJson = renderStats(db)
      validateSnapshot(reposJson, statsJson, { expectedSize: 40958 })
      const repos = ReposArraySchema.parse(JSON.parse(reposJson))
      const stats = StatsArraySchema.parse(JSON.parse(statsJson))
      const expected = JSON.parse(readFileSync(join(root, 'n8n/crawler-fingerprints.json'), 'utf8')) as {
        repositoryCount: number
        statsCount: number
        repositoryIds: string
        repositoryUrls: string
        repositoryFields: Record<string, string>
        stats: string
      }
      expect(repos).toHaveLength(expected.repositoryCount)
      expect(stats).toHaveLength(expected.statsCount)
      expect(fingerprint(repos.map(({ id }) => id))).toBe(expected.repositoryIds)
      expect(fingerprint(repos.map(({ html_url }) => html_url))).toBe(expected.repositoryUrls)
      for (const key of [
        'stargazers_count',
        'forks_count',
        'subscribers_count',
        'description',
        'owner',
        'owner_url',
        'repo_name',
        'plugins_count',
      ] as const) {
        expect(fingerprint(repos.map((repo) => repo[key]))).toBe(expected.repositoryFields[key])
      }
      expect(fingerprint(stats)).toBe(expected.stats)
      if (process.env.CATALOG_UI_PARITY === '1') {
        const current = JSON.parse(readFileSync(join(root, 'ui/src/data/repos.json'), 'utf8')) as typeof repos
        const currentStats = JSON.parse(readFileSync(join(root, 'ui/src/data/stats.json'), 'utf8')) as typeof stats
        expect(fingerprint(repos.map(({ id }) => id))).toBe(fingerprint(current.map(({ id }) => id)))
        for (const key of Object.keys(expected.repositoryFields)) {
          const field = key as keyof (typeof repos)[number]
          expect(fingerprint(repos.map((repo) => repo[field]))).toBe(fingerprint(current.map((repo) => repo[field])))
        }
        expect(fingerprint(repos.map(({ html_url }) => html_url))).toBe(fingerprint(current.map(({ html_url }) => html_url)))
        expect(fingerprint(stats)).toBe(fingerprint(currentStats.map(({ id, date, size }) => ({ id, date, size }))))
      }
      expect(repos.filter(({ plugins_count }) => plugins_count === null)).toHaveLength(303)
      expect(
        repos.some(
          ({ description }) => description !== null && Array.from(description).some((character) => (character.codePointAt(0) ?? 0) > 127),
        ),
      ).toBe(true)
      const lowerCasePaths = new Map<string, number>()
      let caseVariants = 0
      for (const { html_url } of repos) {
        const path = html_url.toLowerCase()
        const count = lowerCasePaths.get(path) ?? 0
        if (count > 0) caseVariants++
        lowerCasePaths.set(path, count + 1)
      }
      expect(caseVariants).toBe(39)
    } finally {
      db.close()
    }
  },
)
