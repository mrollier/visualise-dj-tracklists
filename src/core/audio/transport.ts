/**
 * Playhead arithmetic. The media element is authoritative once it has read the
 * file, but it reports NaN before `loadedmetadata` and Infinity for anything it
 * treats as a stream — so the library's own duration covers the gap.
 */
export function resolveDuration(
  elementDuration: number,
  trackDuration: number | null,
): number | null {
  if (Number.isFinite(elementDuration) && elementDuration > 0) return elementDuration
  return trackDuration !== null && trackDuration > 0 ? trackDuration : null
}

/** Where a seek request actually lands. Unknown duration means nowhere but the start. */
export function clampSeek(seconds: number, duration: number | null): number {
  if (!Number.isFinite(seconds) || duration === null) return 0
  return Math.min(duration, Math.max(0, seconds))
}
