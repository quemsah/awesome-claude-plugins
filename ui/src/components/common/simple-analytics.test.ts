import { afterEach, describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({ mayLoad: false }))

vi.mock('react', () => ({
  useState: () => [
    hooks.mayLoad,
    (value: boolean) => {
      hooks.mayLoad = value
    },
  ],
  useEffect: (effect: () => void) => effect(),
}))

vi.mock('next/script', () => ({ default: 'script' }))

import { SimpleAnalytics } from './SimpleAnalytics.tsx'

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

afterEach(() => {
  if (originalNavigator) {
    Object.defineProperty(globalThis, 'navigator', originalNavigator)
  } else {
    Reflect.deleteProperty(globalThis, 'navigator')
  }
})

function renderAnalytics({ dnt, gpc }: { dnt: boolean; gpc: boolean }) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { doNotTrack: dnt ? '1' : '0', globalPrivacyControl: gpc },
  })

  hooks.mayLoad = false
  SimpleAnalytics({ enabled: true })
  return SimpleAnalytics({ enabled: true })
}

describe('SimpleAnalytics in production', () => {
  it.each([
    { dnt: false, gpc: false, loads: true },
    { dnt: true, gpc: false, loads: true },
    { dnt: false, gpc: true, loads: false },
    { dnt: true, gpc: true, loads: false },
  ])('respects DNT and GPC independently: DNT=$dnt, GPC=$gpc', ({ dnt, gpc, loads }) => {
    const script = renderAnalytics({ dnt, gpc })

    if (!loads) {
      expect(script).toBeNull()
      return
    }

    if (script === null) {
      throw new Error('Expected the analytics script to load')
    }

    expect(script).toMatchObject({
      type: 'script',
      props: { src: 'https://scripts.simpleanalyticscdn.com/latest.js' },
    })
    expect(script.props).not.toHaveProperty('data-collect-dnt')
  })

  it('does not load outside production', () => {
    hooks.mayLoad = false
    SimpleAnalytics({ enabled: false })

    expect(SimpleAnalytics({ enabled: false })).toBeNull()
  })
})
