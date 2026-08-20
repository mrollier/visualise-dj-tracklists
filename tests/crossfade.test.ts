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

  test('centre is both decks at unity', () => {
    // Not equal power. This is a comparison tool, not a transition: the centre
    // is where you listen, so neither candidate may be turned down there.
    const { a, b } = crossfadeGains(0)
    expect(a).toBeCloseTo(1, 10)
    expect(b).toBeCloseTo(1, 10)
  })

  test('the fader never attenuates the deck it points at', () => {
    for (let i = 0; i <= 100; i++) {
      const position = -1 + i / 50
      const { a, b } = crossfadeGains(position)
      if (position <= 0) expect(a).toBeCloseTo(1, 10)
      if (position >= 0) expect(b).toBeCloseTo(1, 10)
    }
  })

  test('no gain ever exceeds unity', () => {
    for (let i = 0; i <= 100; i++) {
      const { a, b } = crossfadeGains(-1 + i / 50)
      expect(a).toBeLessThanOrEqual(1)
      expect(b).toBeLessThanOrEqual(1)
    }
  })

  test('a deck only reaches silence at the far end', () => {
    expect(crossfadeGains(-0.99).b).toBeGreaterThan(0)
    expect(crossfadeGains(0.99).a).toBeGreaterThan(0)
    expect(crossfadeGains(-0.5).b).toBeCloseTo(Math.SQRT1_2, 10)
    expect(crossfadeGains(0.5).a).toBeCloseTo(Math.SQRT1_2, 10)
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
