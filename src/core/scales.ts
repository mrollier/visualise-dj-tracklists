import { color } from 'd3-color'
import { scaleLinear } from 'd3-scale'

/**
 * Node colour encoding. Rating (0–5 stars) is ordinal: one validated ramp
 * step per star. BPM and year are continuous: piecewise interpolation across
 * the same six steps. Each theme gets its own steps in the same hue: on the
 * dark surface higher reads lighter, on the light surface higher reads
 * darker — the standard sequential convention per surface. Lightness is
 * monotonic in every ramp (dataviz sequential check).
 */
export type ColorScheme = 'blue' | 'aqua' | 'violet'
export type ThemeName = 'light' | 'dark'

export const COLOR_SCHEMES: Record<ThemeName, Record<ColorScheme, string[]>> = {
  dark: {
    blue: ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb'],
    aqua: ['#0b5c4d', '#0f7a66', '#12997f', '#3db39a', '#7cccb6', '#bce4d8'],
    violet: ['#5d3ab8', '#7150cf', '#8a6ee0', '#a48ee9', '#c0b0f2', '#ddd3f9'],
  },
  light: {
    blue: ['#8db9f0', '#5f9ce9', '#3987e5', '#2a6dc4', '#1d519d', '#123a72'],
    aqua: ['#79c8b3', '#4bb197', '#12997f', '#0f7f69', '#0b6353', '#08493d'],
    violet: ['#bcabf1', '#a48ee9', '#8a6ee0', '#7150cf', '#5b3cb4', '#452a90'],
  },
}

// Mirrors the --missing token per theme in src/app.css — keep in sync.
export const MISSING_COLORS: Record<ThemeName, string> = {
  dark: '#565550',
  light: '#a3a199',
}

/**
 * App-wide accent family per colour scheme (issue 13): the scheme no longer
 * recolours only the nodes — theme.ts stamps these tokens on <html> so the
 * whole chrome (active buttons, focus rings, set path, genre-map nodes)
 * follows. The BLUE column must equal the defaults in src/app.css (the unit
 * test enforces this sync contract); surfaces stay neutral in every scheme.
 * All accent/on-accent pairs are WCAG-AA checked in tests/scales.test.ts.
 */
export const ACCENT_TOKENS: Record<ThemeName, Record<ColorScheme, Record<string, string>>> = {
  dark: {
    blue: {
      '--accent': '#27a6c4',
      '--on-accent': '#08222a',
      '--walk': '#c98500',
      '--walk-bright': '#eda100',
    },
    aqua: {
      '--accent': '#14ad8d',
      '--on-accent': '#052620',
      '--walk': '#c99500',
      '--walk-bright': '#edb400',
    },
    violet: {
      '--accent': '#9a82e6',
      '--on-accent': '#1b1033',
      '--walk': '#d0784a',
      '--walk-bright': '#ef9251',
    },
  },
  light: {
    blue: {
      '--accent': '#0d7d99',
      '--on-accent': '#ffffff',
      '--walk': '#a86f00',
      '--walk-bright': '#8a5a00',
    },
    aqua: {
      '--accent': '#0b8168',
      '--on-accent': '#ffffff',
      '--walk': '#a87c00',
      '--walk-bright': '#8a6600',
    },
    violet: {
      '--accent': '#5b3cb4',
      '--on-accent': '#ffffff',
      '--walk': '#b05a28',
      '--walk-bright': '#91481f',
    },
  },
}

/**
 * Domain of the wheel's radial scale: the active filter range for the radial
 * metric when the user set one, else the current selection's extent (the
 * radial axis rescales with the filter — design-v6 §A; everything else on
 * the wheel stays put). Degenerate domains widen by ±1 so ticks behave.
 */
export function radialDomain(
  filterRange: [number, number] | null,
  extent: [number, number] | null,
): [number, number] {
  const [lo, hi] = filterRange ?? extent ?? [0, 1]
  return lo === hi ? [lo - 1, hi + 1] : [lo, hi]
}

/**
 * Edge opacity while a track is focused, derived from the user's base edge
 * opacity so the setting keeps working in focus mode (issue 15). The factors
 * are calibrated so the default base (0.35) reproduces the pre-v7 contrast
 * (0.6 in focus, 0.05 dimmed).
 */
export function focusEdgeOpacity(base: number, inFocus: boolean): number {
  return inFocus ? Math.min(0.95, base * 1.7) : base * 0.15
}

export function makeNodeColor(
  axis: 'rating' | 'bpm' | 'year',
  domain: [number, number],
  scheme: ColorScheme,
  theme: ThemeName = 'dark',
): (value: number | null) => string {
  const ramp = COLOR_SCHEMES[theme][scheme]
  const missing = MISSING_COLORS[theme]
  if (axis === 'rating') {
    return (value) => {
      if (value === null) return missing
      return ramp[Math.max(0, Math.min(5, Math.round(value)))]
    }
  }
  const [lo, hi] = domain[0] === domain[1] ? [domain[0] - 1, domain[1] + 1] : domain
  const stops = ramp.map((_, i) => lo + ((hi - lo) * i) / (ramp.length - 1))
  const scale = scaleLinear<string>().domain(stops).range(ramp).clamp(true)
  return (value) => (value === null ? missing : (color(scale(value))?.formatHex() ?? missing))
}
