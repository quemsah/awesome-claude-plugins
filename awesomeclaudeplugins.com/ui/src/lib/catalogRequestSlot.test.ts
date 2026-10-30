import { describe, expect, it } from 'vitest'
import { type CatalogRequestKind, mayStartCatalogRequest } from './catalogRequestSlot.ts'

describe('mayStartCatalogRequest', () => {
  it('lets an append take an empty slot', () => {
    expect(mayStartCatalogRequest(null, 'append')).toBe(true)
  })

  it('refuses an append while a replacement holds the slot', () => {
    // The append would abort the replacement and append its page onto the set being discarded.
    expect(mayStartCatalogRequest('replace', 'append')).toBe(false)
  })

  it('refuses an append while another append holds the slot', () => {
    expect(mayStartCatalogRequest('append', 'append')).toBe(false)
  })

  it.each<CatalogRequestKind | null>(['append', 'replace', null])('lets a replacement take the slot from %s', (held) => {
    expect(mayStartCatalogRequest(held, 'replace')).toBe(true)
  })
})
