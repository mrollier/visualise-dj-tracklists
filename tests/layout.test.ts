import { describe, expect, test } from 'vitest'
import { slotAngleOffsets } from '../src/core/layout'

describe('slotAngleOffsets', () => {
  test('a single node sits on the slot centre', () => {
    expect(slotAngleOffsets(1)).toEqual([0])
  })

  test('multiple nodes fan out symmetrically across the slot', () => {
    expect(slotAngleOffsets(2, 11)).toEqual([-5.5, 5.5])
    expect(slotAngleOffsets(3, 11)).toEqual([-5.5, 0, 5.5])
  })

  test('offsets stay within the given spread regardless of count', () => {
    const offsets = slotAngleOffsets(9, 11)
    expect(Math.min(...offsets)).toBeGreaterThanOrEqual(-5.5)
    expect(Math.max(...offsets)).toBeLessThanOrEqual(5.5)
    expect(new Set(offsets).size).toBe(9)
  })
})
