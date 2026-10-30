import { describe, expect, it, vi } from 'vitest'
import { createOptionalSessionStorage } from './optionalSessionStorage.ts'

describe('optionalSessionStorage', () => {
  it('preserves normal get and set behavior', () => {
    const values = new Map<string, string>()
    const onUnavailable = vi.fn()
    const storage = createOptionalSessionStorage(
      () => ({
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
      }),
      onUnavailable
    )

    storage.setItem('last-search-url', '/?q=claude')

    expect(storage.getItem('last-search-url')).toBe('/?q=claude')
    expect(onUnavailable).not.toHaveBeenCalled()
  })

  it('disables optional storage when the sessionStorage getter throws', () => {
    const onUnavailable = vi.fn()
    const storage = createOptionalSessionStorage(() => {
      throw new DOMException('Storage is disabled', 'SecurityError')
    }, onUnavailable)

    expect(storage.getItem('last-search-url')).toBeNull()
    expect(() => storage.setItem('last-search-url', '/?q=private')).not.toThrow()
    expect(onUnavailable).toHaveBeenCalledTimes(1)
  })

  it('disables optional storage when getItem throws', () => {
    const onUnavailable = vi.fn()
    const storage = createOptionalSessionStorage(
      () => ({
        getItem: () => {
          throw new DOMException('Storage is disabled', 'SecurityError')
        },
        setItem: vi.fn(),
      }),
      onUnavailable
    )

    expect(storage.getItem('last-search-url')).toBeNull()
    expect(() => storage.setItem('last-search-url', '/?q=private')).not.toThrow()
    expect(onUnavailable).toHaveBeenCalledTimes(1)
  })

  it('disables optional storage when setItem throws', () => {
    const onUnavailable = vi.fn()
    const storage = createOptionalSessionStorage(
      () => ({
        getItem: vi.fn(),
        setItem: () => {
          throw new DOMException('Storage is disabled', 'SecurityError')
        },
      }),
      onUnavailable
    )

    expect(() => storage.setItem('last-search-url', '/?q=private')).not.toThrow()
    expect(storage.getItem('last-search-url')).toBeNull()
    expect(onUnavailable).toHaveBeenCalledTimes(1)
  })
})
