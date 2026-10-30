import { beforeEach, describe, expect, it } from 'vitest'
import {
  catalogScrollKey,
  clearScrollPosition,
  isCatalogListPath,
  readScrollPosition,
  type ScrollStore,
  saveScrollPosition,
} from './catalogScroll.ts'

function createStore(initial: Record<string, string> = {}): ScrollStore & { dump: () => Record<string, string> } {
  const data: Record<string, string> = { ...initial }
  return {
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value
    },
    dump: () => data,
  }
}

function storedPositions(store: ReturnType<typeof createStore>): Record<string, number> {
  return JSON.parse(store.dump()['catalog-scroll-positions'] ?? '{}') as Record<string, number>
}

describe('catalogScroll', () => {
  let store: ReturnType<typeof createStore>

  beforeEach(() => {
    store = createStore()
  })

  it('returns no offset for a url that was never visited', () => {
    expect(readScrollPosition(store, '/')).toBe(0)
  })

  it('round-trips an offset for the same url', () => {
    saveScrollPosition(store, '/', 1234)
    expect(readScrollPosition(store, '/')).toBe(1234)
  })

  it('keeps offsets for different search states independent', () => {
    saveScrollPosition(store, '/?q=superpowers', 900)
    saveScrollPosition(store, '/', 400)

    expect(readScrollPosition(store, '/?q=superpowers')).toBe(900)
    expect(readScrollPosition(store, '/')).toBe(400)
  })

  it('overwrites the offset for a url instead of accumulating history', () => {
    saveScrollPosition(store, '/', 400)
    saveScrollPosition(store, '/', 70)

    expect(storedPositions(store)).toEqual({ '/': 70 })
  })

  it('rounds fractional offsets so zoomed viewports do not churn the store', () => {
    saveScrollPosition(store, '/', 1200.6)
    expect(readScrollPosition(store, '/')).toBe(1201)
  })

  it('clears only the given url', () => {
    saveScrollPosition(store, '/', 400)
    saveScrollPosition(store, '/?sort=forks-desc', 800)

    clearScrollPosition(store, '/')

    expect(readScrollPosition(store, '/')).toBe(0)
    expect(readScrollPosition(store, '/?sort=forks-desc')).toBe(800)
  })

  it('keeps the ten most recently written urls', () => {
    for (let index = 0; index < 11; index += 1) {
      saveScrollPosition(store, `/?q=query-${index}`, 100 * index)
    }
    saveScrollPosition(store, '/?q=query-10', 5_000)
    saveScrollPosition(store, '/?q=query-0', 6_000)

    const positions = storedPositions(store)
    expect(Object.keys(positions)).toHaveLength(10)
    expect(positions['/?q=query-1']).toBeUndefined()
    expect(positions['/?q=query-0']).toBe(6_000)
    expect(positions['/?q=query-10']).toBe(5_000)
  })

  it('drops entries a browser extension could have written into the same key', () => {
    store = createStore({ 'catalog-scroll-positions': '{"?broken":"tall","/":120,"/gone":-5}' })

    expect(readScrollPosition(store, '/')).toBe(120)
    expect(readScrollPosition(store, '/?broken')).toBe(0)
    expect(readScrollPosition(store, '/gone')).toBe(0)

    saveScrollPosition(store, '/?q=next', 10)
    expect(storedPositions(store)).toEqual({ '/': 120, '/?q=next': 10 })
  })

  it('recovers from malformed json in the store', () => {
    store = createStore({ 'catalog-scroll-positions': 'not json' })

    expect(readScrollPosition(store, '/')).toBe(0)
    saveScrollPosition(store, '/', 250)
    expect(readScrollPosition(store, '/')).toBe(250)
  })

  it('accepts only non-object json shapes it can discard', () => {
    for (const raw of ['null', '42', '[1,2]', 'true']) {
      store = createStore({ 'catalog-scroll-positions': raw })
      expect(readScrollPosition(store, '/')).toBe(0)
    }
  })

  describe('isCatalogListPath', () => {
    it('matches only the catalog list route', () => {
      expect(isCatalogListPath('/')).toBe(true)
      expect(isCatalogListPath('/ykdojo/claude-code-tips')).toBe(false)
      expect(isCatalogListPath('/browse/2')).toBe(false)
      expect(isCatalogListPath('/stats')).toBe(false)
    })
  })

  describe('catalogScrollKey', () => {
    it('joins pathname and search the way the address bar reports them', () => {
      expect(catalogScrollKey('/', '')).toBe('/')
      expect(catalogScrollKey('/', '?q=hello&sort=forks-desc')).toBe('/?q=hello&sort=forks-desc')
    })
  })
})
