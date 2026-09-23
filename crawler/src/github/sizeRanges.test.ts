import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SIZE_RANGES } from './sizeRanges.js'

describe('GitHub Code Search size ranges', () => {
  it('preserves the permanent ordered 220-range fingerprint without needing the workflow', () => {
    expect(SIZE_RANGES).toHaveLength(220)
    expect(SIZE_RANGES[0]).toEqual([0, 150])
    expect(SIZE_RANGES.at(-1)).toEqual([270001, 400000])
    expect(createHash('sha256').update(JSON.stringify(SIZE_RANGES)).digest('hex')).toBe(
      'e37032a92e70bfa56d47f82b7075a77f04a588a87f5d56326f52bac0bfbd6510',
    )
    expect(Object.isFrozen(SIZE_RANGES)).toBe(true)
    expect(SIZE_RANGES.every((range) => Object.isFrozen(range))).toBe(true)
  })

  it('covers every integer file size from 0 through 400000 with the intended endpoint overlaps', () => {
    expect(SIZE_RANGES[0][0]).toBe(0)
    expect(SIZE_RANGES.at(-1)?.[1]).toBe(400000)
    expect(SIZE_RANGES.every(([min, max]) => Number.isInteger(min) && min <= max && Number.isInteger(max))).toBe(true)
    expect(SIZE_RANGES.every((range, index) => index === 0 || range[0] > SIZE_RANGES[index - 1][0])).toBe(true)
    expect(SIZE_RANGES.every((range, index) => index === 0 || range[0] <= SIZE_RANGES[index - 1][1] + 1)).toBe(true)
    expect(SIZE_RANGES.filter((range, index) => index > 0 && range[0] <= SIZE_RANGES[index - 1][1])).toHaveLength(71)
    expect(SIZE_RANGES[1]).toEqual([150, 200])
    expect(SIZE_RANGES[2]).toEqual([200, 216])
  })
})
