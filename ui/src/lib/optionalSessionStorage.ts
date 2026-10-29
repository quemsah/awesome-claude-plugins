type SessionStorageMethods = Pick<Storage, 'getItem' | 'setItem'>

export function createOptionalSessionStorage(
  getStorage: () => SessionStorageMethods | null,
  onUnavailable: () => void = () => {}
): SessionStorageMethods {
  let available = true

  const disable = () => {
    if (available) {
      available = false
      onUnavailable()
    }
  }

  return {
    getItem(key) {
      if (!available) {
        return null
      }
      try {
        const storage = getStorage()
        if (!storage) {
          disable()
          return null
        }
        return storage.getItem(key)
      } catch {
        disable()
        return null
      }
    },
    setItem(key, value) {
      if (!available) {
        return
      }
      try {
        const storage = getStorage()
        if (!storage) {
          disable()
          return
        }
        storage.setItem(key, value)
      } catch {
        disable()
      }
    },
  }
}

export const optionalSessionStorage = createOptionalSessionStorage(
  () => (typeof window === 'undefined' ? null : window.sessionStorage),
  () => console.warn('Optional sessionStorage is unavailable; catalog search history and scroll position will not be saved.')
)
