import { expect, it } from 'vitest'
import { MarketplaceFormatError, parseMarketplace } from './marketplace.js'

it('counts only plugin entries with a name and source', () => {
  const marketplace = parseMarketplace({
    name: 'catalog',
    owner: { name: 'maintainer' },
    plugins: [
      { arbitrary: true },
      { name: 'missing-source' },
      { source: './plugins/unnamed' },
      { name: 'empty-source', source: '' },
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

it('rejects a document without the required marketplace root fields', () => {
  expect(() => parseMarketplace({ name: 'catalog', owner: { name: 'maintainer' }, plugins: {} })).toThrow(MarketplaceFormatError)
})

it.each([
  { name: '', owner: { name: 'maintainer' }, plugins: [] },
  { name: 'catalog', owner: { name: '' }, plugins: [] },
])('rejects empty required marketplace names', (input) => {
  expect(() => parseMarketplace(input)).toThrow(MarketplaceFormatError)
})
