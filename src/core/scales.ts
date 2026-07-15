import { color } from 'd3-color'
import { scaleLinear } from 'd3-scale'

/**
 * Node colour encoding. Rating (0–5 stars) is ordinal: one validated ramp
 * step per star. BPM and year are continuous: piecewise interpolation across
 * the same six steps. On the dark surface, higher always reads lighter.
 * Every ramp passed the dataviz ordinal checks (dark surface #1a1a19).
 */
export type ColorScheme = 'blue' | 'aqua' | 'violet'

export const COLOR_SCHEMES: Record<ColorScheme, string[]> = {
  blue: ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb'],
  aqua: ['#0b5c4d', '#0f7a66', '#12997f', '#3db39a', '#7cccb6', '#bce4d8'],
  violet: ['#5d3ab8', '#7150cf', '#8a6ee0', '#a48ee9', '#c0b0f2', '#ddd3f9'],
}

export const MISSING_COLOR = '#565550'

export function makeNodeColor(
  axis: 'rating' | 'bpm' | 'year',
  domain: [number, number],
  scheme: ColorScheme,
): (value: number | null) => string {
  const ramp = COLOR_SCHEMES[scheme]
  if (axis === 'rating') {
    return (value) => {
      if (value === null) return MISSING_COLOR
      return ramp[Math.max(0, Math.min(5, Math.round(value)))]
    }
  }
  const [lo, hi] = domain[0] === domain[1] ? [domain[0] - 1, domain[1] + 1] : domain
  const stops = ramp.map((_, i) => lo + ((hi - lo) * i) / (ramp.length - 1))
  const scale = scaleLinear<string>().domain(stops).range(ramp).clamp(true)
  return (value) =>
    value === null ? MISSING_COLOR : (color(scale(value))?.formatHex() ?? MISSING_COLOR)
}
