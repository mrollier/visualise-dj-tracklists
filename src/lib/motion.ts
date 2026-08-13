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
