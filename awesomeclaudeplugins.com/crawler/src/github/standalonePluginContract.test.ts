import { readFileSync } from 'node:fs'
import { parseStandalonePlugin, StandalonePluginFormatError, toStandaloneCatalogManifest } from '@awesome-claude-plugins/catalog-contract'
import { expect, it } from 'vitest'
import { MarketplaceFormatError, parseMarketplace } from './marketplace.js'

it('accepts minimal and non-kebab-case manifests without marketplace metadata', () => {
  for (const name of ['reviewer', 'Review Tools']) expect(parseStandalonePlugin({ name })).toEqual({ name })
  expect(() => parseMarketplace({ name: 'reviewer' })).toThrow(MarketplaceFormatError)
})

it.each([null, [], {}, { name: '' }, { name: '  ' }, { name: 1 }, { name: 'x'.repeat(161) }, { name: 'x\ny' }, { name: '\ud800' }])(
  'rejects invalid standalone identity %j',
  (value) => {
    expect(() => parseStandalonePlugin(value)).toThrow(StandalonePluginFormatError)
  },
)

it('normalizes a validated plugin at repository root without trusting a source override', () => {
  const manifest = parseStandalonePlugin({ name: 'reviewer', source: 'https://untrusted.example', metadata: { custom: true } })
  expect(toStandaloneCatalogManifest(manifest)).toEqual({ manifestKind: 'standalone-plugin', plugins: [{ ...manifest, source: './' }] })
})

it('reads the shared minimal standalone fixture', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../../shared/fixtures/standalone-plugin/v1/minimal.json', import.meta.url), 'utf8'))
  expect(parseStandalonePlugin(fixture)).toEqual({ name: 'reviewer' })
})
