import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { getPluginInstallCommand } from '../../lib/installCommand.ts'
import { getMarketplaceName, MarketplacePluginsSchema } from './plugin.type.ts'

const fixturesDirectory = resolve(process.cwd(), '../test/fixtures/marketplace/v1')
const fixtures = readdirSync(fixturesDirectory)
  .filter((file) => file.endsWith('.json'))
  .map((file) => JSON.parse(readFileSync(resolve(fixturesDirectory, file), 'utf8')) as MarketplaceContractFixture)

type MarketplaceContractFixture = {
  name: string
  version: number
  expected: {
    valid: boolean
    pluginsCount: number | null
    pluginNames?: string[]
    plugin?: Record<string, unknown>
    installCommand?: string
    reason?: string
  }
  input: unknown
}

it.each(fixtures)('matches marketplace contract v$version for $name: $expected.reason', (fixture) => {
  const result = MarketplacePluginsSchema.safeParse(fixture.input)
  expect(result.success).toBe(fixture.expected.valid)
  if (result.success) {
    expect(result.data.plugins.length).toBe(fixture.expected.pluginsCount)
    if (fixture.expected.pluginNames) expect(result.data.plugins.map((plugin) => plugin.id)).toEqual(fixture.expected.pluginNames)
    if (fixture.expected.plugin) {
      const expected = { ...fixture.expected.plugin }
      if (typeof expected.commands === 'string') expected.commands = [expected.commands]
      expect(result.data.plugins[0]).toMatchObject(expected)
    }
    if (fixture.expected.installCommand) {
      expect(
        getPluginInstallCommand({
          pluginName: result.data.plugins[0]?.name,
          pluginId: result.data.plugins[0]?.id,
          marketplaceName: getMarketplaceName(fixture.input),
        })
      ).toBe(fixture.expected.installCommand)
    }
  }
})
