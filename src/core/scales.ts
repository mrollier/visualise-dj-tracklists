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
