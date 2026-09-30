import { afterEach, describe, expect, test, vi } from 'vitest'
import { LARGE_WHEEL_NODES, motionMs, prefersReducedMotion, wheelMotionMs } from '../src/lib/motion'

describe('motion (v18 issue 11b)', () => {
  afterEach(() => {
    // Only the stubbed-window cases below touch this; harmless no-op
    // otherwise. Keeps the stub from leaking into the no-window cases.
    vi.unstubAllGlobals()
  })

  test('prefersReducedMotion is false without a window (node test env)', () => {
    // No jsdom in this suite's vitest environment (vite.config.ts's `test`
    // block sets 'node'), so `window` itself is undefined — the guard this
    // exercises.
    expect(prefersReducedMotion()).toBe(false)
  })

  test('motionMs passes the duration through when there is no window', () => {
    expect(motionMs(600)).toBe(600)
    expect(motionMs(0)).toBe(0)
  })

  test('prefersReducedMotion is true when matchMedia reports a match', () => {
    // motion.ts reads window.matchMedia lazily inside the function body —
    // nothing is captured at module-load time — so a plain stubGlobal
    // before the call is enough; no vi.resetModules()/dynamic import needed.
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
    expect(prefersReducedMotion()).toBe(true)
  })

  test('prefersReducedMotion is false when matchMedia reports no match', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
    expect(prefersReducedMotion()).toBe(false)
  })

  test('motionMs collapses to 0 under reduced motion — its actual purpose', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
    expect(motionMs(600)).toBe(0)
  })

  test('motionMs still passes the duration through with a window present but no preference', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
    expect(motionMs(600)).toBe(600)
  })
})

describe('wheel motion', () => {
  test('a wheel of ordinary size glides as designed', () => {
    expect(wheelMotionMs(600, 2)).toBe(600)
    expect(wheelMotionMs(600, LARGE_WHEEL_NODES)).toBe(600)
  })

  test('a very large wheel lands instantly: a glide there is a stutter', () => {
    expect(wheelMotionMs(600, LARGE_WHEEL_NODES + 1)).toBe(0)
  })
})
