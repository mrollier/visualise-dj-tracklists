/**
 * Reduced-motion plumbing for JS-driven animation (Svelte `transition:` /
 * `Tween` durations), which a `@media (prefers-reduced-motion: reduce)`
 * block can't reach since those durations are plain numbers evaluated in
 * script, not CSS. Same matchMedia precedent as theme.ts's system-theme
 * listener (theme.ts:26).
 */

/**
 * True when the user's OS/browser is set to `prefers-reduced-motion:
 * reduce`. Guarded for the test environment, where `window` doesn't exist
 * at all (not just `matchMedia`) — treated the same as "no preference".
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** `ms` unchanged, or 0 (instant) when the user prefers reduced motion. */
export function motionMs(ms: number): number {
  return prefersReducedMotion() ? 0 : ms
}

/**
 * Above this many visible tracks the wheel stops gliding: each frame of a
 * glide re-positions every star, which at thousands of nodes is a stutter
 * rather than motion. On a laptop, switching the radius axis at 10k tracks
 * took six frames over 50 ms (the worst 417 ms) animated, one 350 ms frame
 * instant; at 5k, 750 ms of stutter against one 183 ms frame.
 *
 * ponytail: one probe's threshold; canvas-drawn stars are the upgrade if a
 * 10k-track wheel must animate.
 */
export const LARGE_WHEEL_NODES = 1500

/** `ms` for a wheel of `nodeCount` visible tracks: instant past LARGE_WHEEL_NODES. */
export function wheelMotionMs(ms: number, nodeCount: number): number {
  return nodeCount > LARGE_WHEEL_NODES ? 0 : motionMs(ms)
}
