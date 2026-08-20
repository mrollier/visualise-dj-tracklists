/**
 * Equal-power crossfade. `position` runs -1 (all A) to +1 (all B).
 *
 * gainA² + gainB² = 1 at every position. A linear fader (1-t, t) delivers only
 * half the power at centre — the classic audible dip — and centre is exactly
 * where an A/B comparison sits, so the hole would land on the one spot the
 * feature exists for.
 */
export function crossfadeGains(position: number): { a: number; b: number } {
  const clamped = Number.isFinite(position) ? Math.min(1, Math.max(-1, position)) : 0
  const t = (clamped + 1) / 2
  return { a: Math.cos((t * Math.PI) / 2), b: Math.sin((t * Math.PI) / 2) }
}
