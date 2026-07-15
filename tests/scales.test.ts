import { describe, expect, test } from 'vitest'
import { COLOR_SCHEMES, makeNodeColor, MISSING_COLORS } from '../src/core/scales'

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
