import { describe, expect, test } from 'vitest'
import { captureDisplaced, numericMapsEqual } from '../src/core/displaced'

describe('captureDisplaced (v20 #2)', () => {
  test('settled (oldFrom null): captures the old target verbatim', () => {
    const oldTargets = new Map([
      ['a', 10],
      ['b', 20],
    ])
    const captured = captureDisplaced(oldTargets, null, () => 1)
    expect(captured.get('a')).toBe(10)
    expect(captured.get('b')).toBe(20)
  })

  test('settled (id missing from oldFrom): that id also captures verbatim', () => {
    const oldTargets = new Map([
      ['a', 10],
      ['b', 20],
    ])
    const oldFrom = new Map([['a', 4]]) // 'b' never glided
    // progressOf would blow up an id-agnostic implementation that used it
    // for 'b' too — never called for a settled id.
    const captured = captureDisplaced(oldTargets, oldFrom, (id) => {
      if (id === 'b') throw new Error('progressOf must not be called for a settled id')
      return 0.5
    })
    expect(captured.get('b')).toBe(20)
  })

  test('mid-flight: from + (target − from) · progressOf(id), per-node clocks honoured', () => {
    const oldTargets = new Map([
      ['fast', 100],
      ['slow', 100],
    ])
    const oldFrom = new Map([
      ['fast', 0],
      ['slow', 0],
    ])
    const progress = new Map([
      ['fast', 0.8],
      ['slow', 0.2],
    ])
    const captured = captureDisplaced(oldTargets, oldFrom, (id) => progress.get(id)!)
    expect(captured.get('fast')).toBeCloseTo(80, 10)
    expect(captured.get('slow')).toBeCloseTo(20, 10)
  })

  test('progress 0 captures exactly the from value', () => {
    const oldTargets = new Map([['a', 50]])
    const oldFrom = new Map([['a', 13]])
    const captured = captureDisplaced(oldTargets, oldFrom, () => 0)
    expect(captured.get('a')).toBe(13)
  })

  test('progress 1 captures the target, to floating-point precision', () => {
    const oldTargets = new Map([['a', 217.5]])
    const oldFrom = new Map([['a', -34.25]])
    const captured = captureDisplaced(oldTargets, oldFrom, () => 1)
    expect(captured.get('a')).toBeCloseTo(217.5, 10)
  })

  test('ids absent from oldTargets are dropped, even if oldFrom still carries them', () => {
    const oldTargets = new Map([['a', 10]])
    const oldFrom = new Map([
      ['a', 0],
      ['stale', 999], // e.g. a track removed from the library since
    ])
    const captured = captureDisplaced(oldTargets, oldFrom, () => 0.5)
    expect(captured.has('stale')).toBe(false)
    expect(captured.size).toBe(1)
  })

  test('retarget continuity: a value chained through two captures never jumps', () => {
    // The load-bearing property: displaying a node right after a SECOND
    // capture, at progress 0 of the new glide, must render the identical
    // value it rendered right before that second capture — i.e. the second
    // capture's "from" picks up exactly where the first glide's frozen
    // position left off, with no discontinuity at the retarget instant.
    const display = (from: number | undefined, target: number, t: number): number =>
      from === undefined ? target : from + (target - from) * t

    // Settled at 10; a first retarget captures it verbatim (oldFrom null)
    // as the "from" for a glide toward a new target of 100.
    const settledTargets = new Map([['a', 10]])
    const firstCapture = captureDisplaced(settledTargets, null, () => 0.3)
    const firstFrom = firstCapture.get('a')! // === 10 (settled capture)
    const firstTarget = new Map([['a', 100]])
    const midT = 0.3
    const displayedBeforeSecondCapture = display(firstFrom, 100, midT)

    // Second retarget interrupts glide #1 right at midT, against a NEW
    // target map (200) that replaces glide #1's own target (100) — the
    // OLD target this capture must read is firstTarget, not the new one.
    const secondTargets = new Map([['a', 200]])
    const secondCapture = captureDisplaced(firstTarget, firstCapture, () => midT)
    // captureDisplaced captures the OLD target (100) frozen at the OLD
    // glide's own progress against the OLD from (10) — exactly
    // displayedBeforeSecondCapture.
    const secondFrom = secondCapture.get('a')!
    expect(secondFrom).toBeCloseTo(displayedBeforeSecondCapture, 10)

    // Displaying against the new glide at progress 0 renders exactly that
    // same frozen value — no jump at the retarget instant.
    const displayedAfterSecondCapture = display(secondFrom, secondTargets.get('a')!, 0)
    expect(displayedAfterSecondCapture).toBeCloseTo(displayedBeforeSecondCapture, 10)
  })
})

describe('numericMapsEqual (v20 #2)', () => {
  test('identical reference is equal (fast path)', () => {
    const m = new Map([['a', 1]])
    expect(numericMapsEqual(m, m)).toBe(true)
  })

  test('equal values survive different insertion orders', () => {
    const a = new Map([
      ['a', 1],
      ['b', 2],
    ])
    const b = new Map([
      ['b', 2],
      ['a', 1],
    ])
    expect(numericMapsEqual(a, b)).toBe(true)
  })

  test('a size mismatch is never equal', () => {
    const a = new Map([['a', 1]])
    const b = new Map([
      ['a', 1],
      ['b', 2],
    ])
    expect(numericMapsEqual(a, b)).toBe(false)
  })

  test('one differing value is enough to break equality', () => {
    const a = new Map([
      ['a', 1],
      ['b', 2],
    ])
    const b = new Map([
      ['a', 1],
      ['b', 2.0001],
    ])
    expect(numericMapsEqual(a, b)).toBe(false)
  })
})
