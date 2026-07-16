import { describe, expect, test } from 'vitest'
import { initStack, record, redo, undo, type UndoSnapshot } from '../src/core/history'

function snap(overrides: Partial<UndoSnapshot> = {}): UndoSnapshot {
  return { trackIds: [], generated: false, selectedId: null, ...overrides }
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
})
