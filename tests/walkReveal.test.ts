import { describe, expect, test } from 'vitest'
import { revealRange, WALK_REVEAL_STEP_MS, walkRevealPlan } from '../src/core/walkReveal'

describe('walkRevealPlan (v12 WS1)', () => {
  test('empty walk: nothing to reveal, zero duration', () => {
    const plan = walkRevealPlan([], { stepMs: 100 })
    expect(plan.nodeDelays.size).toBe(0)
    expect(plan.edgeDelays).toEqual([])
    expect(plan.totalMs).toBe(0)
  })

  test('single track: one node at delay 0, no edges', () => {
    const plan = walkRevealPlan(['a'], { stepMs: 100 })
    expect(plan.nodeDelays.get('a')).toBe(0)
    expect(plan.edgeDelays).toEqual([])
    expect(plan.totalMs).toBe(100)
  })

  test('edge i draws while node i+1 waits: chained staggering', () => {
    const plan = walkRevealPlan(['a', 'b', 'c'], { stepMs: 100 })
    expect(plan.nodeDelays.get('a')).toBe(0)
    expect(plan.nodeDelays.get('b')).toBe(100)
    expect(plan.nodeDelays.get('c')).toBe(200)
    expect(plan.edgeDelays).toEqual([0, 100])
    expect(plan.totalMs).toBe(300)
  })

  test('a duplicated track keeps its first-occurrence delay', () => {
    // Duplicates are legal in a set (v5 remark 15); the dot lights up once,
    // when the walk first reaches it.
    const plan = walkRevealPlan(['a', 'b', 'a'], { stepMs: 100 })
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

describe('revealRange (S4 diff)', () => {
  test('pure extension → animate the appended tail', () => {
    expect(revealRange(['a', 'b', 'c'], ['a', 'b', 'c', 'd', 'e'])).toEqual({ from: 3, to: 5 })
  })
  test('two-arm seam-fill → animate only the middle', () => {
    // old = startArm(s1,s2) ++ reverse(endArm)(e2,e1); new inserts m1,m2 in the seam
    expect(revealRange(['s1', 's2', 'e2', 'e1'], ['s1', 's2', 'm1', 'm2', 'e2', 'e1'])).toEqual({
      from: 2,
      to: 4,
    })
  })
  test('identical → empty animated range', () => {
    expect(revealRange(['a', 'b'], ['a', 'b'])).toEqual({ from: 2, to: 2 })
  })
})

describe('walkRevealPlan resume (S4)', () => {
  test('prefix nodes are not re-pulsed; tail animates from the seam', () => {
    const plan = walkRevealPlan(['a', 'b', 'c', 'd', 'e'], { stepMs: 100, from: 3, to: 5 })
    expect(plan.from).toBe(3)
    expect(plan.origin).toBe(2)
    expect(plan.nodeDelays.has('a')).toBe(false)
    expect(plan.nodeDelays.has('c')).toBe(false)
    expect(plan.nodeDelays.get('d')).toBe(100) // (3-2)*100
    expect(plan.nodeDelays.get('e')).toBe(200) // (4-2)*100
    expect(plan.edgeDelays).toEqual([null, null, 0, 100]) // seam edge c→d at 0
    expect(plan.totalMs).toBe(300) // (5-2)*100
  })
  test('from=0 reduces to the original full reveal', () => {
    const plan = walkRevealPlan(['a', 'b', 'c'], { stepMs: 100 })
    expect(plan.from).toBe(0)
    expect(plan.origin).toBe(0)
    expect(plan.nodeDelays.get('a')).toBe(0)
    expect(plan.edgeDelays).toEqual([0, 100])
    expect(plan.totalMs).toBe(300)
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
