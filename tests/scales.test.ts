import { describe, expect, test } from 'vitest'
import {
  ACCENT_TOKENS,
  COLOR_SCHEMES,
  focusEdgeOpacity,
  makeNodeColor,
  MISSING_COLORS,
  radialDomain,
} from '../src/core/scales'

/** WCAG relative-luminance contrast between two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('ACCENT_TOKENS (app-wide colour scheme, issue 13)', () => {
  const themes = ['dark', 'light'] as const
  const schemes = ['blue', 'aqua', 'violet'] as const
  const tokens = ['--accent', '--on-accent', '--walk', '--walk-bright'] as const

  test('every theme × scheme carries the full accent family as hex colours', () => {
    for (const theme of themes) {
      for (const scheme of schemes) {
        for (const token of tokens) {
          expect(ACCENT_TOKENS[theme][scheme][token]).toMatch(/^#[0-9a-f]{6}$/)
        }
      }
    }
  })

  test('accent on on-accent stays readable (WCAG AA, 4.5:1)', () => {
    for (const theme of themes) {
      for (const scheme of schemes) {
        const t = ACCENT_TOKENS[theme][scheme]
        expect(contrast(t['--accent'], t['--on-accent'])).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  test('the blue scheme IS the app.css default — the sync contract', () => {
    expect(ACCENT_TOKENS.dark.blue).toEqual({
      '--accent': '#27a6c4',
      '--on-accent': '#08222a',
      '--walk': '#c98500',
      '--walk-bright': '#eda100',
    })
    expect(ACCENT_TOKENS.light.blue).toEqual({
      '--accent': '#0d7d99',
      '--on-accent': '#ffffff',
      '--walk': '#a86f00',
      '--walk-bright': '#8a5a00',
    })
  })
})

describe('focusEdgeOpacity', () => {
  test('star edges brighten from the base edge opacity (issue 15, v9 issue 8)', () => {
    // the default 0.35 reproduces the pre-v7 hardcoded in-focus contrast (0.6)
    expect(focusEdgeOpacity(0.35)).toBeCloseTo(0.6, 1)
    // the star always draws brighter than the cluster's plain base
    for (const base of [0.1, 0.35, 0.6, 0.9]) {
      expect(focusEdgeOpacity(base)).toBeGreaterThan(base)
    }
  })

  test('zero base hides edges entirely; high bases stay clamped', () => {
    expect(focusEdgeOpacity(0)).toBe(0)
    expect(focusEdgeOpacity(0.9)).toBeLessThanOrEqual(0.95)
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
