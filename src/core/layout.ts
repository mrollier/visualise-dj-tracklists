/**
 * Evenly spaced angular offsets (degrees) for `count` nodes sharing one key
 * slot, centred on the slot and never exceeding ±spread/2. Tracks in the same
 * key often sit at nearly the same radius (close BPM), so fanning them out
 * angularly keeps every node hoverable.
 */
export function slotAngleOffsets(count: number, spreadDeg: number): number[] {
  if (count <= 1) return Array.from({ length: count }, () => 0)
  const step = spreadDeg / (count - 1)
  return Array.from({ length: count }, (_, i) => -spreadDeg / 2 + i * step)
}

/**
 * SVG path of an annular (ring) sector between radii r0..r1 spanning angles
 * a0..a1, in degrees clockwise from 12 o'clock — the wheel's convention.
 * Used for the subtle per-key major/minor sector backgrounds.
 */
export function annularSectorPath(
  cx: number,
  cy: number,
  a0: number,
  a1: number,
  r0: number,
  r1: number,
): string {
  const round = (v: number) => Math.round(v * 100) / 100
  const point = (angleDeg: number, r: number) => {
    const rad = ((angleDeg - 90) * Math.PI) / 180
    return [round(cx + r * Math.cos(rad)), round(cy + r * Math.sin(rad))]
  }
  const large = a1 - a0 > 180 ? 1 : 0
  const [ox0, oy0] = point(a0, r1)
  const [ox1, oy1] = point(a1, r1)
  const [ix1, iy1] = point(a1, r0)
  const [ix0, iy0] = point(a0, r0)
  return (
    `M ${ox0} ${oy0} ` +
    `A ${r1} ${r1} 0 ${large} 1 ${ox1} ${oy1} ` +
    `L ${ix1} ${iy1} ` +
    `A ${r0} ${r0} 0 ${large} 0 ${ix0} ${iy0} Z`
  )
}
