import { describe, expect, test } from 'vitest'
import { crossfadeGains } from '../src/core/audio/crossfade'

describe('crossfadeGains', () => {
  test('hard left is all A', () => {
    const { a, b } = crossfadeGains(-1)
    expect(a).toBeCloseTo(1, 10)
    expect(b).toBeCloseTo(0, 10)
  })

  test('hard right is all B', () => {
    const { a, b } = crossfadeGains(1)
    expect(a).toBeCloseTo(0, 10)
    expect(b).toBeCloseTo(1, 10)
  })

  test('centre is equal power, not equal amplitude', () => {
    const { a, b } = crossfadeGains(0)
    expect(a).toBeCloseTo(Math.SQRT1_2, 10)
    expect(b).toBeCloseTo(Math.SQRT1_2, 10)
  })

  test('total power is constant across the whole sweep', () => {
    // A linear fader would dip to half power at centre — an audible hole
    // exactly where an A/B comparison sits.
    for (let i = 0; i <= 100; i++) {
      const { a, b } = crossfadeGains(-1 + i / 50)
      expect(a * a + b * b).toBeCloseTo(1, 10)
    }
  })

  test('A falls and B rises monotonically', () => {
    let previous = crossfadeGains(-1)
    for (let i = 1; i <= 100; i++) {
      const next = crossfadeGains(-1 + i / 50)
      expect(next.a).toBeLessThanOrEqual(previous.a)
      expect(next.b).toBeGreaterThanOrEqual(previous.b)
      previous = next
    }
  })

  test('clamps a position outside the fader range', () => {
    expect(crossfadeGains(-9)).toEqual(crossfadeGains(-1))
    expect(crossfadeGains(9)).toEqual(crossfadeGains(1))
  })

  test('falls back to centre for a non-finite position', () => {
    expect(crossfadeGains(NaN)).toEqual(crossfadeGains(0))
  })
})
