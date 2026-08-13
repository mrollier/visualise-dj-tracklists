import { describe, expect, test } from 'vitest'
import { motionMs, prefersReducedMotion } from '../src/lib/motion'

describe('motion (v18 issue 11b)', () => {
  test('prefersReducedMotion is false without a window (node test env)', () => {
    // No jsdom in this suite's vitest environment (vitest.config.ts sets
    // 'node'), so `window` itself is undefined — the guard this exercises.
    expect(prefersReducedMotion()).toBe(false)
  })

  test('motionMs passes the duration through when there is no window', () => {
    expect(motionMs(600)).toBe(600)
    expect(motionMs(0)).toBe(0)
  })
})
