import { describe, expect, test } from 'vitest'
import {
  COLOR_SCHEMES,
  focusEdgeOpacity,
  makeNodeColor,
  MISSING_COLORS,
  radialDomain,
} from '../src/core/scales'

describe('focusEdgeOpacity', () => {
  test('scales both focus states from the base edge opacity (issue 15)', () => {
    // the default 0.35 reproduces the pre-v7 hardcoded contrast (0.6 / 0.05)
    expect(focusEdgeOpacity(0.35, true)).toBeCloseTo(0.6, 1)
    expect(focusEdgeOpacity(0.35, false)).toBeCloseTo(0.05, 1)
    // in-focus is always brighter than dimmed for any positive base
    for (const base of [0.1, 0.35, 0.6, 0.9]) {
      expect(focusEdgeOpacity(base, true)).toBeGreaterThan(focusEdgeOpacity(base, false))
    }
  })

  test('zero base hides edges entirely; high bases stay clamped', () => {
    expect(focusEdgeOpacity(0, true)).toBe(0)
    expect(focusEdgeOpacity(0, false)).toBe(0)
    expect(focusEdgeOpacity(0.9, true)).toBeLessThanOrEqual(0.95)
  })
})

describe('makeNodeColor', () => {
  test('rating uses the ordinal ramp: 0 first step, 5 last step, null missing', () => {
    const color = makeNodeColor('rating', [0, 5], 'blue')
    expect(color(0)).toBe(COLOR_SCHEMES.dark.blue[0])
    expect(color(5)).toBe(COLOR_SCHEMES.dark.blue[5])
    expect(color(null)).toBe(MISSING_COLORS.dark)
  })

  test('rating values are clamped and rounded into the six steps', () => {
    const color = makeNodeColor('rating', [0, 5], 'blue')
    expect(color(7)).toBe(COLOR_SCHEMES.dark.blue[5])
    expect(color(2.6)).toBe(COLOR_SCHEMES.dark.blue[3])
  })

  test('bpm interpolates continuously across the ramp endpoints', () => {
    const color = makeNodeColor('bpm', [100, 180], 'blue')
    expect(color(100)).toBe(COLOR_SCHEMES.dark.blue[0])
    expect(color(180)).toBe(COLOR_SCHEMES.dark.blue[5])
    const mid = color(140)
    expect(mid).not.toBe(color(100))
    expect(mid).not.toBe(color(180))
    expect(color(null)).toBe(MISSING_COLORS.dark)
  })

  test('the light theme selects its own ramp and missing colour', () => {
    const color = makeNodeColor('rating', [0, 5], 'blue', 'light')
    expect(color(0)).toBe(COLOR_SCHEMES.light.blue[0])
    expect(color(5)).toBe(COLOR_SCHEMES.light.blue[5])
    expect(color(null)).toBe(MISSING_COLORS.light)
  })

  test('degenerate domains (single value) do not blow up', () => {
    const color = makeNodeColor('year', [2020, 2020], 'aqua')
    expect(typeof color(2020)).toBe('string')
  })

  test('every scheme has six steps in both themes', () => {
    for (const theme of Object.values(COLOR_SCHEMES)) {
      for (const ramp of Object.values(theme)) {
        expect(ramp).toHaveLength(6)
        for (const hex of ramp) expect(hex).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })
})

describe('radialDomain', () => {
  test('an active filter range wins over the library extent', () => {
    expect(radialDomain([122, 128], [90, 180])).toEqual([122, 128])
  })

  test('falls back to the extent when the filter is inactive', () => {
    expect(radialDomain(null, [90, 180])).toEqual([90, 180])
  })

  test('no filter and no extent yields a safe default', () => {
    expect(radialDomain(null, null)).toEqual([0, 1])
  })

  test('degenerate domains are widened so ticks behave', () => {
    expect(radialDomain([128, 128], null)).toEqual([127, 129])
    expect(radialDomain(null, [2020, 2020])).toEqual([2019, 2021])
  })
})
