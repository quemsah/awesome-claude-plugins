import { expect, it } from 'vitest'
import {
  getMarketplacePluginRejection,
  isMarketplacePlugin,
  MarketplaceFormatError,
  parseMarketplace,
  resolveMarketplacePluginDisplayName,
} from './marketplace.js'

it('counts only plugin entries with a name and source', () => {
  const marketplace = parseMarketplace({
    name: 'catalog',
    owner: { name: 'maintainer' },
    plugins: [
      { arbitrary: true },
      { name: 'missing-source' },
      { source: './plugins/unnamed' },
      { name: 'empty-source', source: '' },
      { name: '    ', source: './plugins/whitespace-name' },
      { name: 'whitespace-source', source: '  ' },
      { name: 'missing-github-repo', source: { source: 'github' } },
      { name: 'missing-url', source: { source: 'url' } },
      { name: 'invalid-source', source: { arbitrary: true } },
      { name: 'valid-local', source: './plugins/valid' },
      { name: 'valid-github', source: { source: 'github', repo: 'team/tool' } },
      null,
      'unexpected entry',
      [],
    ],
  })

  expect(marketplace.plugins).toEqual([
    { name: 'valid-local', source: './plugins/valid' },
    { name: 'valid-github', source: { source: 'github', repo: 'team/tool' } },
  ])
})

it('rejects unsafe plugin identifiers such as names with spaces matching UI validation', () => {
  const reproduction = {
    name: 'demo',
    owner: { name: 'Maintainer' },
    plugins: [{ name: 'bad name', source: './plugins/demo' }],
  }
  const result = parseMarketplace(reproduction)
  expect(result.plugins).toEqual([])
  expect(isMarketplacePlugin(reproduction.plugins[0])).toBe(false)
  expect(getMarketplacePluginRejection(reproduction.plugins[0])).toBe('Must be a safe plugin identifier')
})

it('preserves human-readable display names without rejecting valid canonical identifiers', () => {
  const manifest = {
    name: 'demo',
    owner: { name: 'Maintainer' },
    plugins: [
      { name: 'valid-plugin', displayName: 'Human Readable Display Label', source: './plugins/demo' },
      { name: 'another-plugin', displayName: '   ', source: './plugins/another' },
    ],
  }
  const result = parseMarketplace(manifest)
  expect(result.plugins.length).toBe(2)
  expect(resolveMarketplacePluginDisplayName(manifest.plugins[0])).toBe('Human Readable Display Label')
  expect(resolveMarketplacePluginDisplayName(manifest.plugins[1])).toBe('another-plugin')
})

it('rejects unsafe identifiers even when display name is provided', () => {
  const entry = { name: 'bad name', displayName: 'Valid Display Label', source: './plugins/demo' }
  expect(isMarketplacePlugin(entry)).toBe(false)
  expect(getMarketplacePluginRejection(entry)).toBe('Must be a safe plugin identifier')
})

it('rejects a document without the required marketplace root fields', () => {
  expect(() => parseMarketplace({ name: 'catalog', owner: { name: 'maintainer' }, plugins: {} })).toThrow(MarketplaceFormatError)
})

it('rejects a standalone MCP server manifest without a plugin catalogue', () => {
  expect(() =>
    parseMarketplace({
      name: 'standalone-server',
      owner: { name: 'maintainer' },
      mcpServers: { filesystem: { command: 'node', args: ['server.js'] } },
    }),
  ).toThrow(MarketplaceFormatError)
})

it.each([
  { name: '', owner: { name: 'maintainer' }, plugins: [] },
  { name: 'catalog', owner: { name: '' }, plugins: [] },
])('rejects empty required marketplace names', (input) => {
  expect(() => parseMarketplace(input)).toThrow(MarketplaceFormatError)
})
