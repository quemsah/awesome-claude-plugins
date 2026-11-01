import { readFileSync } from 'node:fs'
import { parseStandalonePlugin, toStandaloneCatalogManifest } from '@awesome-claude-plugins/catalog-contract'
import { expect, it } from 'vitest'

it('shares the crawler standalone identity contract and root source', () => {
  const fixture = JSON.parse(
    readFileSync(new URL('../../../../shared/fixtures/standalone-plugin/v1/minimal.json', import.meta.url), 'utf8')
  )
  expect(toStandaloneCatalogManifest(parseStandalonePlugin(fixture))).toEqual({
    manifestKind: 'standalone-plugin',
    plugins: [{ name: 'reviewer', source: './' }],
  })
})
