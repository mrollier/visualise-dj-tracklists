/**
 * Evenly spaced angular offsets (degrees) for `count` nodes sharing one key
 * slot, centred on the slot and never exceeding ±spread/2. Tracks in the same
 * key often sit at nearly the same radius (close BPM), so fanning them out
 * angularly keeps every node hoverable.
 */
export function slotAngleOffsets(count: number, spreadDeg = 11): number[] {
  if (count <= 1) return Array.from({ length: count }, () => 0)
  const step = spreadDeg / (count - 1)
  return Array.from({ length: count }, (_, i) => -spreadDeg / 2 + i * step)
}
