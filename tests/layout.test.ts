import { describe, expect, test } from 'vitest'
import {
  annularSectorPath,
  minAngularGapDeg,
  relaxSlotAngles,
  type SlotNode,
} from '../src/core/layout'

describe('minAngularGapDeg (issue 17)', () => {
  const P = 5 // world-unit node radius

  test('same radius: the chord condition, 2·asin(p/r)', () => {
    const expected = (2 * Math.asin(P / 200) * 180) / Math.PI
    expect(minAngularGapDeg(200, 200, P)).toBeCloseTo(expected, 6)
  })

  test('radii further apart than a node diameter never interact', () => {
    expect(minAngularGapDeg(100, 112, P)).toBe(0)
    expect(minAngularGapDeg(300, 290, P)).toBe(0) // exactly 2p apart
  })

  test('nearby but unequal radii need less gap than equal ones', () => {
    const equal = minAngularGapDeg(200, 200, P)
    const offset = minAngularGapDeg(200, 204, P)
    expect(offset).toBeGreaterThan(0)
    expect(offset).toBeLessThan(equal)
  })

  test('degenerate radii near the centre give up gracefully', () => {
    expect(minAngularGapDeg(0, 0, P)).toBe(0)
    expect(minAngularGapDeg(3, 4, P)).toBe(0)
  })
})

describe('relaxSlotAngles (issue 17)', () => {
  const P = 5
  const node = (id: string, r: number): SlotNode => ({ id, r })

  test('empty and single inputs are trivial', () => {
    expect(relaxSlotAngles([], 7.5, P).size).toBe(0)
    expect(relaxSlotAngles([node('a', 200)], 7.5, P).get('a')).toBe(0)
  })

  test('zero spread collapses everything to the slot centre', () => {
    const out = relaxSlotAngles([node('a', 200), node('b', 200)], 0, P)
    expect(out.get('a')).toBe(0)
    expect(out.get('b')).toBe(0)
  })

  test('deterministic: input order never changes the result', () => {
    const nodes = [node('a', 200), node('b', 203), node('c', 320), node('d', 200)]
    const shuffled = [nodes[2], nodes[0], nodes[3], nodes[1]]
    const first = relaxSlotAngles(nodes, 7.5, P)
    const second = relaxSlotAngles(shuffled, 7.5, P)
    expect(Object.fromEntries(second)).toEqual(Object.fromEntries(first))
  })

  test('interacting pairs end at least their chord gap apart (below saturation)', () => {
    // A/B share a radius, C/D share another; the two clumps ignore each
    // other. The window is roomy enough that full chord gaps and a centred
    // cloud (v10 issue 5) both hold; in a tighter window centring wins and
    // gaps compress gracefully.
    const out = relaxSlotAngles(
      [node('a', 200), node('b', 200), node('c', 320), node('d', 320)],
      6,
      P,
    )
    const gapAB = Math.abs((out.get('a') ?? 0) - (out.get('b') ?? 0))
    const gapCD = Math.abs((out.get('c') ?? 0) - (out.get('d') ?? 0))
    expect(gapAB).toBeGreaterThanOrEqual(minAngularGapDeg(200, 200, P) - 0.05)
    expect(gapCD).toBeGreaterThanOrEqual(minAngularGapDeg(320, 320, P) - 0.05)
    for (const offset of out.values()) {
      expect(Math.abs(offset)).toBeLessThanOrEqual(6 + 1e-9)
    }
  })

  test('non-interacting nodes keep the even initial spread', () => {
    const out = relaxSlotAngles([node('low', 150), node('high', 300)], 6, P)
    const values = [...out.values()].sort((x, y) => x - y)
    expect(values).toEqual([-6, 6])
  })

  const mean = (out: Map<string, number>): number =>
    [...out.values()].reduce((a, b) => a + b, 0) / out.size

  test('the cloud stays centred on the slot line (mean offset ≈ 0)', () => {
    // A dense, asymmetric slot: mixed radii that interact and saturate the
    // window. The weight of the key must sit on its angle, not drift off it.
    const nodes = [
      ...Array.from({ length: 20 }, (_, i) => node(`lo${i}`, 120)),
      ...Array.from({ length: 12 }, (_, i) => node(`hi${i}`, 122)),
    ]
    expect(Math.abs(mean(relaxSlotAngles(nodes, 4, P)))).toBeLessThan(0.02)
  })

  test('saturation stays centred (mean offset ≈ 0)', () => {
    const nodes = Array.from({ length: 50 }, (_, i) => node(`n${i}`, 110))
    expect(Math.abs(mean(relaxSlotAngles(nodes, 7.5, P)))).toBeLessThan(0.02)
  })

  test('saturation squeezes evenly: bounded, finite, roughly uniform', () => {
    const nodes = Array.from({ length: 50 }, (_, i) => node(`n${i}`, 110))
    const out = relaxSlotAngles(nodes, 7.5, P)
    const angles = [...out.values()].sort((x, y) => x - y)
    expect(angles).toHaveLength(50)
    for (const a of angles) {
      expect(Number.isFinite(a)).toBe(true)
      expect(Math.abs(a)).toBeLessThanOrEqual(7.5 + 1e-9)
    }
    const gaps = angles.slice(1).map((a, i) => a - angles[i])
    expect(Math.max(...gaps)).toBeLessThanOrEqual(1)
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(0.05)
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
