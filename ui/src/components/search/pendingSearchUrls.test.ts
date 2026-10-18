import { describe, expect, it } from 'vitest'
import { PendingSearchUrls } from './pendingSearchUrls.ts'

describe('PendingSearchUrls', () => {
  it('recognizes local URL commits so a trimmed URL does not overwrite an in-progress search', () => {
    const pending = new PendingSearchUrls()
    pending.track('/?q=claude')
    expect(pending.consume('/?q=claude')).toBe(true)
    expect(pending.consume('/?q=claude')).toBe(false)
  })

  it('allows older in-flight updates to finish without losing a newer pending navigation', () => {
    const pending = new PendingSearchUrls()
    pending.track('/?q=cl')
    pending.track('/?q=claude')
    expect(pending.consume('/?q=cl')).toBe(true)
    expect(pending.consume('/?q=claude')).toBe(true)
  })

  it('retires cancelled older URL markers after the latest URL commits', () => {
    const pending = new PendingSearchUrls()
    pending.track('/?q=cl')
    pending.track('/?q=claude')
    expect(pending.consume('/?q=claude')).toBe(true)
    // A later independent link to a cancelled URL must synchronize the input.
    expect(pending.consume('/?q=cl')).toBe(false)
  })

  it('clears pending state on external navigation and browser history events', () => {
    const pending = new PendingSearchUrls()
    pending.track('/?q=cl')
    expect(pending.consume('/?q=other')).toBe(false)
    expect(pending.consume('/?q=cl')).toBe(false)

    pending.track('/?q=cl')
    pending.clear() // popstate
    expect(pending.consume('/?q=cl')).toBe(false)
  })

  it('handles a URL being issued again after another navigation', () => {
    const pending = new PendingSearchUrls()
    pending.track('/?q=cl')
    pending.track('/?q=claude')
    pending.track('/?q=cl')
    expect(pending.consume('/?q=cl')).toBe(true)
    expect(pending.consume('/?q=claude')).toBe(false)
  })
})
