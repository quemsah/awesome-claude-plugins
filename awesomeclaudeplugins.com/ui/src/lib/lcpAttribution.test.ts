import { describe, expect, it } from 'vitest'
import { classifyLcpElement } from './lcpAttribution.ts'

describe('classifyLcpElement', () => {
  it('classifies generic LCP targets without retaining sensitive attributes', () => {
    expect(classifyLcpElement([{ element: { tagName: 'IMG', src: '/private?token=secret' } }])).toBe('image')
    expect(classifyLcpElement([{ element: { tagName: 'H1', textContent: 'private title' } }])).toBe('text')
    expect(classifyLcpElement([{ element: { tagName: 'CANVAS', id: 'secret' } }])).toBe('other')
  })

  it('handles missing and unrecognized entries', () => {
    expect(classifyLcpElement([])).toBeNull()
    expect(classifyLcpElement([{ startTime: 1 }])).toBeNull()
  })
})
