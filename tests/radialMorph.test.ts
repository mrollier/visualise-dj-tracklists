import { describe, expect, test } from 'vitest'
import {
  RADIAL_MORPH_MOVE_MS,
  RADIAL_MORPH_SWEEP_MS,
  RADIAL_MORPH_TOTAL_MS,
  radialMorphDelays,
  radialMorphProgress,
} from '../src/core/radialMorph'

describe('radialMorphDelays (v18 #11a)', () => {
  test("delays increase monotonically with angle, clockwise from 12 o'clock", () => {
    const nodes = [0, 90, 180, 270, 359].map((angleDeg, i) => ({ id: `n${i}`, angleDeg }))
    const delays = radialMorphDelays(nodes)
    const values = nodes.map((n) => delays.get(n.id)!)
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1])
  })

  test('wraps at 360 back to the same delay as 0 degrees', () => {
    const delays = radialMorphDelays([
      { id: 'zero', angleDeg: 0 },
      { id: 'full-turn', angleDeg: 360 },
      { id: 'past-a-turn', angleDeg: 720 + 15 },
      { id: 'fifteen', angleDeg: 15 },
    ])
    expect(delays.get('full-turn')).toBe(delays.get('zero'))
    expect(delays.get('past-a-turn')).toBe(delays.get('fifteen'))
  })

  test('a null angle (gutter/unkeyed node) leads the sweep at delay 0', () => {
    const delays = radialMorphDelays([
      { id: 'gutter', angleDeg: null },
      { id: 'twelve', angleDeg: 0 },
      { id: 'six', angleDeg: 180 },
    ])
    expect(delays.get('gutter')).toBe(0)
    expect(delays.get('gutter')).toBe(delays.get('twelve'))
  })

  test('a custom sweep window scales every delay proportionally', () => {
    const nodes = [{ id: 'quarter', angleDeg: 90 }]
    expect(radialMorphDelays(nodes, 400).get('quarter')).toBe(100)
    expect(radialMorphDelays(nodes).get('quarter')).toBe(RADIAL_MORPH_SWEEP_MS / 4)
  })

  test('deterministic: repeated calls with the same input agree', () => {
    const nodes = [
      { id: 'a', angleDeg: 42 },
      { id: 'b', angleDeg: null },
    ]
    expect(radialMorphDelays(nodes)).toEqual(radialMorphDelays(nodes))
  })

  test('the exported constants leave every node enough room to finish inside the total', () => {
    // A node can start as late as (just under) RADIAL_MORPH_SWEEP_MS; it
    // still needs RADIAL_MORPH_MOVE_MS to glide — the budget only works if
    // that never overruns the whole window.
    expect(RADIAL_MORPH_SWEEP_MS + RADIAL_MORPH_MOVE_MS).toBeLessThanOrEqual(RADIAL_MORPH_TOTAL_MS)
  })
})

describe('radialMorphProgress (v18 #11a)', () => {
  test("progress is 0 until the node's own delay has elapsed", () => {
    expect(radialMorphProgress(0, 200)).toBe(0)
    // globalT=0.1 over the default 600ms total is 60ms elapsed — short of a
    // 200ms delay.
    expect(radialMorphProgress(0.1, 200)).toBe(0)
  })

  test('progress reaches 1 by the end of the tween, for any delay up to the max sweep', () => {
    expect(radialMorphProgress(1, 0)).toBe(1)
    expect(radialMorphProgress(1, RADIAL_MORPH_SWEEP_MS)).toBe(1)
  })

  test('monotone non-decreasing in globalT for a fixed delay', () => {
    let previous = -Infinity
    for (let t = 0; t <= 1; t += 0.05) {
      const progress = radialMorphProgress(t, 100)
      expect(progress).toBeGreaterThanOrEqual(previous)
      previous = progress
    }
  })

  test('eased, not linear: midpoint progress exceeds the linear midpoint', () => {
    // delay 0, so globalT sweeps the node's own [0, moveMs] window directly.
    const midT = RADIAL_MORPH_MOVE_MS / 2 / RADIAL_MORPH_TOTAL_MS
    expect(radialMorphProgress(midT, 0)).toBeGreaterThan(0.5)
  })

  test('a later delay is never ahead of an earlier one at the same instant', () => {
    const early = radialMorphProgress(0.5, 0)
    const late = radialMorphProgress(0.5, 200)
    expect(late).toBeLessThanOrEqual(early)
  })

  test('custom totalMs/moveMs are honoured', () => {
    // 250ms into a 1000ms total, 0 delay, 500ms move: 250/500 = the move's
    // midpoint — same raw fraction (and so the same eased result) as the
    // default constants' own midpoint case above (180ms into 600ms, 360ms
    // move: 180/360 = 0.5 too).
    expect(radialMorphProgress(0.25, 0, 1000, 500)).toBeCloseTo(radialMorphProgress(0.3, 0), 5)
  })

  test('deterministic: repeated calls with the same input agree', () => {
    expect(radialMorphProgress(0.37, 120)).toBe(radialMorphProgress(0.37, 120))
  })
})
