import { describe, expect, test } from 'vitest'
import { initStack, record, redo, sameWork, undo, type UndoSnapshot } from '../src/core/history'

function snap(overrides: Partial<UndoSnapshot> = {}): UndoSnapshot {
  return {
    trackIds: [],
    generated: false,
    selectedId: null,
    tuning: '{}',
    marks: '[]',
    pins: '{}',
    ...overrides,
  }
}

describe('undo stack', () => {
  test('record → undo → redo round-trips', () => {
    let stack = initStack(snap())
    stack = record(stack, snap({ trackIds: ['a'] }))
    stack = record(stack, snap({ trackIds: ['a', 'b'], selectedId: 'b' }))

    const undone = undo(stack)!
    expect(undone.present.trackIds).toEqual(['a'])
    const redone = redo(undone)!
    expect(redone.present.trackIds).toEqual(['a', 'b'])
    expect(redone.present.selectedId).toBe('b')
  })

  test('recording clears the redo future', () => {
    let stack = initStack(snap())
    stack = record(stack, snap({ trackIds: ['a'] }))
    stack = undo(stack)!
    stack = record(stack, snap({ trackIds: ['x'] }))
    expect(redo(stack)).toBeNull()
    expect(stack.present.trackIds).toEqual(['x'])
  })

  test('a deep-equal snapshot is a no-op record', () => {
    let stack = initStack(snap({ trackIds: ['a'] }))
    stack = record(stack, snap({ trackIds: ['a'] }))
    expect(stack.past).toHaveLength(0)
  })

  test('the generated flag rides along, so undoing a generator overwrite restores it', () => {
    let stack = initStack(snap({ trackIds: ['a'], generated: false }))
    stack = record(stack, snap({ trackIds: ['g1', 'g2'], generated: true }))
    const undone = undo(stack)!
    expect(undone.present).toEqual(snap({ trackIds: ['a'], generated: false }))
  })

  test('undo/redo at the ends return null', () => {
    const stack = initStack(snap())
    expect(undo(stack)).toBeNull()
    expect(redo(stack)).toBeNull()
  })

  test('the limit trims the oldest entries', () => {
    let stack = initStack(snap())
    for (let i = 0; i < 10; i++) {
      stack = record(stack, snap({ trackIds: [`t${i}`] }), 5)
    }
    expect(stack.past.length).toBeLessThanOrEqual(5)
    // the newest states are the ones kept
    expect(undo(stack)!.present.trackIds).toEqual(['t8'])
  })

  test('a tuning-only change records an undoable step (v12 WS14)', () => {
    let stack = initStack(snap({ tuning: '{"edgeOpacity":0.35}' }))
    stack = record(stack, snap({ tuning: '{"edgeOpacity":0.6}' }))
    expect(stack.past).toHaveLength(1)
    expect(undo(stack)!.present.tuning).toBe('{"edgeOpacity":0.35}')
    // …and an identical tuning stays a no-op.
    stack = record(stack, snap({ tuning: '{"edgeOpacity":0.6}' }))
    expect(stack.past).toHaveLength(1)
  })

  test('sameWork ignores tuning: it tells a settings tweak from a set edit', () => {
    const base = snap({ trackIds: ['a'], tuning: 'x' })
    expect(sameWork(base, snap({ trackIds: ['a'], tuning: 'y' }))).toBe(true)
    expect(sameWork(base, snap({ trackIds: ['a', 'b'], tuning: 'x' }))).toBe(false)
    expect(sameWork(base, snap({ trackIds: ['a'], selectedId: 'a', tuning: 'x' }))).toBe(false)
    // A manual-edge mark is a work edit, never debounced like tuning.
    expect(sameWork(base, snap({ trackIds: ['a'], tuning: 'x', marks: '[x]' }))).toBe(false)
  })
})
