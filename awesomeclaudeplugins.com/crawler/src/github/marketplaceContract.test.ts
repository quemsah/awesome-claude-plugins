import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { parseMarketplace } from './marketplace.js'

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
  let result: ReturnType<typeof parseMarketplace> | undefined
  try {
    result = parseMarketplace(fixture.input)
  } catch {
    result = undefined
  }

  expect(result !== undefined).toBe(fixture.expected.valid)
  if (result) {
    expect(result.plugins.length).toBe(fixture.expected.pluginsCount)
    expect(result.plugins.map((plugin) => plugin.name)).toEqual(fixture.expected.pluginNames)
  }
})
