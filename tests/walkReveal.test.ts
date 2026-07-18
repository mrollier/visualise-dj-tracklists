import { describe, expect, test } from 'vitest'
import { WALK_REVEAL_STEP_MS, walkRevealPlan } from '../src/core/walkReveal'

describe('walkRevealPlan (v12 WS1)', () => {
  test('empty walk: nothing to reveal, zero duration', () => {
    const plan = walkRevealPlan([], 100)
    expect(plan.nodeDelays.size).toBe(0)
    expect(plan.edgeDelays).toEqual([])
    expect(plan.totalMs).toBe(0)
  })

  test('single track: one node at delay 0, no edges', () => {
    const plan = walkRevealPlan(['a'], 100)
    expect(plan.nodeDelays.get('a')).toBe(0)
    expect(plan.edgeDelays).toEqual([])
    expect(plan.totalMs).toBe(100)
  })

  test('edge i draws while node i+1 waits: chained staggering', () => {
    const plan = walkRevealPlan(['a', 'b', 'c'], 100)
    expect(plan.nodeDelays.get('a')).toBe(0)
    expect(plan.nodeDelays.get('b')).toBe(100)
    expect(plan.nodeDelays.get('c')).toBe(200)
    expect(plan.edgeDelays).toEqual([0, 100])
    expect(plan.totalMs).toBe(300)
  })

  test('a duplicated track keeps its first-occurrence delay', () => {
    // Duplicates are legal in a set (v5 remark 15); the dot lights up once,
    // when the walk first reaches it.
    const plan = walkRevealPlan(['a', 'b', 'a'], 100)
    expect(plan.nodeDelays.size).toBe(2)
    expect(plan.nodeDelays.get('a')).toBe(0)
    expect(plan.edgeDelays).toEqual([0, 100])
    expect(plan.totalMs).toBe(300)
  })

  test('the default step is the exported constant', () => {
    const plan = walkRevealPlan(['a', 'b'])
    expect(plan.nodeDelays.get('b')).toBe(WALK_REVEAL_STEP_MS)
  })
})

describe('long-walk cap (v12)', () => {
  test('a 99-track walk reveals in about four seconds, not fourteen', () => {
    const plan = walkRevealPlan(Array.from({ length: 99 }, (_, i) => `t${i}`))
    expect(plan.totalMs).toBeLessThanOrEqual(4500)
    expect(plan.totalMs).toBeGreaterThan(2000)
  })

  test('short walks keep the full per-step pace', () => {
    expect(walkRevealPlan(['a', 'b', 'c']).totalMs).toBe(3 * WALK_REVEAL_STEP_MS)
  })
})
