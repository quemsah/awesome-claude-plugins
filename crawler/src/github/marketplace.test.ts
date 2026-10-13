import { expect, it } from 'vitest'
import { MarketplaceFormatError, parseMarketplace } from './marketplace.js'

it('counts only entries with a valid name and source', () => {
  const marketplace = parseMarketplace({
    name: 'catalog',
    owner: { name: 'maintainer' },
    plugins: [
      { name: 'valid', source: './plugins/valid' },
      {
        name: 'valid-remote',
        source: {
          source: './plugins/valid-remote',
          repo: 'acme/plugins',
          url: 'https://github.com/acme/plugins',
          sha: 'abcdef0',
        },
      },
      { name: 'missing-source' },
      { source: './plugins/missing-name' },
      { name: 'invalid-source', source: { source: '../unsafe' } },
      {},
      null,
      'unexpected entry',
      [],
    ],
  })

  expect(marketplace.plugins).toEqual([
    { name: 'valid', source: './plugins/valid' },
    {
      name: 'valid-remote',
      source: {
        source: './plugins/valid-remote',
        repo: 'acme/plugins',
        url: 'https://github.com/acme/plugins',
        sha: 'abcdef0',
      },
    },
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
