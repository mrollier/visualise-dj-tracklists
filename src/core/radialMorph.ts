import { cubicOut } from 'svelte/easing'

/**
 * Per-node radial morph on an axis swap (v18 #11a).
 *
 * The prior mechanism tweened the radial DOMAIN's endpoints (old axis's
 * range → new axis's range) while every track's VALUE switched to the new
 * axis instantly. Mid-tween, `radialScale(newAxisValue)` read against a
 * domain still straddling both axes' numeric ranges — often nowhere near
 * `newAxisValue` — so the clamp pinned nodes to the rim until the domain
 * caught up (rim-pinning).
 *
 * This module is the pure planning half of the fix: instead of one shared
 * domain, each node glides its OWN settled scalar (radius if keyed, gutter y
 * if not) from its old value straight to its new one, independent of any
 * domain. `radialMorphDelays` staggers the glides into a clockwise sweep
 * from 12 o'clock; `radialMorphProgress` turns a node's delay plus a single
 * shared 0..1 tween into that node's own eased 0..1 progress. WheelView.svelte
 * owns lerping `from`/`to` by that progress — see its wiring comment for how
 * the domain tween (still driving rings/ticks, and still the whole story for
 * same-axis filter changes) and this per-node morph divide the work.
 */

/** Total morph duration — matches WheelView's RADIAL_TWEEN_MS so nodes settle
 * WITH the rings/ticks, which keep animating on the pre-existing domain tween. */
export const RADIAL_MORPH_TOTAL_MS = 600
/** Window the per-node start delays are spread across: 0 (12 o'clock) up to
 * just under this value, approaching a full turn back around to 12 o'clock. */
export const RADIAL_MORPH_SWEEP_MS = 240
/** How long a single node's own glide takes, once its delay has elapsed. */
export const RADIAL_MORPH_MOVE_MS = 360
// RADIAL_MORPH_SWEEP_MS + RADIAL_MORPH_MOVE_MS === RADIAL_MORPH_TOTAL_MS: the
// last node to start (delay approaching the sweep's ceiling) still finishes
// exactly as the shared tween lands. Enforced in radialMorph.test.ts, not
// just asserted here — the constants are free to move as long as the sum
// relationship (checked there) keeps holding.

/**
 * Per-node start delay (ms) for the sweep, proportional to angle clockwise
 * from 12 o'clock (0°) up to just under a full turn — so every node starts
 * within a single clockwise pass, never wrapping mid-gesture. Gutter/unkeyed
 * nodes (`angleDeg: null` — they have no position on the ring) lead the
 * sweep at delay 0, alongside the 12 o'clock slot.
 */
export function radialMorphDelays(
  nodes: readonly { id: string; angleDeg: number | null }[],
  sweepMs: number = RADIAL_MORPH_SWEEP_MS,
): Map<string, number> {
  const delays = new Map<string, number>()
  for (const { id, angleDeg } of nodes) {
    if (angleDeg === null) {
      delays.set(id, 0)
      continue
    }
    const wrapped = ((angleDeg % 360) + 360) % 360
    delays.set(id, (wrapped / 360) * sweepMs)
  }
  return delays
}

/**
 * A node's own eased progress (0..1) at a shared tween's global time
 * `globalT` (0..1 over `totalMs`), given the node's `delayMs` from
 * `radialMorphDelays`: flat at 0 until the delay has elapsed, then eases
 * (cubicOut, matching the domain tween's own easing curve) over `moveMs`.
 * Reaches 1 by `globalT = 1` for every delay up to `RADIAL_MORPH_SWEEP_MS`
 * (see the constants' relationship above) — the shared tween itself must run
 * with LINEAR easing for `globalT` to correspond proportionally to elapsed
 * time, or this per-node math would run against the wrong clock.
 */
export function radialMorphProgress(
  globalT: number,
  delayMs: number,
  totalMs: number = RADIAL_MORPH_TOTAL_MS,
  moveMs: number = RADIAL_MORPH_MOVE_MS,
): number {
  const elapsedMs = globalT * totalMs
  const raw = (elapsedMs - delayMs) / moveMs
  return cubicOut(Math.max(0, Math.min(1, raw)))
}
