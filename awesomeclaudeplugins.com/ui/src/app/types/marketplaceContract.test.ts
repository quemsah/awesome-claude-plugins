import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { MarketplacePluginsSchema } from './plugin.type.ts'

const fixturesDirectory = resolve(process.cwd(), '../shared/fixtures/marketplace/v1')
const fixtures = readdirSync(fixturesDirectory)
  .filter((file) => file.endsWith('.json'))
  .map((file) => JSON.parse(readFileSync(resolve(fixturesDirectory, file), 'utf8')) as MarketplaceContractFixture)

type MarketplaceContractFixture = {
  name: string
  version: number
  expected: { valid: boolean; pluginsCount: number | null; pluginNames: string[] | null }
  input: unknown
}

it.each(fixtures)('matches marketplace contract v$version for $name', (fixture) => {
  const result = MarketplacePluginsSchema.safeParse(fixture.input)
  expect(result.success).toBe(fixture.expected.valid)
  if (result.success) {
    expect(result.data.plugins.length).toBe(fixture.expected.pluginsCount)
    expect(result.data.plugins.map((plugin) => plugin.name)).toEqual(fixture.expected.pluginNames)
  }
})
