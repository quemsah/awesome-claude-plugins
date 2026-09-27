import { expect, it } from 'vitest'
import { MarketplaceFormatError, parseMarketplace } from './marketplace.js'

it('counts plugin entries without validating their fields', () => {
  const marketplace = parseMarketplace({
    name: 'catalog',
    owner: { name: 'maintainer' },
    plugins: [{}, null, 'unexpected entry'],
  })

  expect(marketplace.plugins).toHaveLength(3)
})

it('rejects a document without the required marketplace root fields', () => {
  expect(() => parseMarketplace({ name: 'catalog', owner: { name: 'maintainer' }, plugins: {} })).toThrow(MarketplaceFormatError)
})
