import { describe, expect, test } from 'vitest'
import { annularSectorPath, slotAngleOffsets } from '../src/core/layout'

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

describe('annularSectorPath', () => {
  // Angles are degrees clockwise from 12 o'clock, matching the wheel.
  const numbers = (path: string) => (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)

  test("a quarter wedge starts at the outer 12 o'clock point and closes", () => {
    const path = annularSectorPath(0, 0, 0, 90, 100, 200)
    expect(path.startsWith('M')).toBe(true)
    expect(path.trim().endsWith('Z')).toBe(true)
    const [x0, y0] = numbers(path)
    expect(x0).toBeCloseTo(0, 6) // 12 o'clock, outer radius
    expect(y0).toBeCloseTo(-200, 6)
    expect((path.match(/A/g) ?? []).length).toBe(2) // outer + inner arc
  })

  test('is offset by the given centre', () => {
    const path = annularSectorPath(400, 300, 0, 90, 100, 200)
    const [x0, y0] = numbers(path)
    expect(x0).toBeCloseTo(400, 6)
    expect(y0).toBeCloseTo(100, 6)
  })

  test('contains the inner start corner (arc back to angle a0 at r0)', () => {
    const path = annularSectorPath(0, 0, 90, 180, 50, 60)
    // Sector from 3 o'clock to 6 o'clock: inner corner at (50, 0).
    const nums = numbers(path)
    const points = nums.join(',')
    expect(points).toContain('50,')
  })
})
