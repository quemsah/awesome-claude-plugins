type SessionStorageStore = Pick<Storage, 'getItem' | 'setItem'>

export function safeSessionStorage(): SessionStorageStore | null {
  try {
    const storage = window.sessionStorage
    return {
      getItem(key) {
        try {
          return storage.getItem(key)
        } catch {
          return null
        }
      },
      setItem(key, value) {
        try {
          storage.setItem(key, value)
        } catch {
          // Session state is optional, so blocked storage must not interrupt the UI.
        }
      },
    }
  } catch {
    return null
  }
}
