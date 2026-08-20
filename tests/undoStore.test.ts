import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { clearStarsInScope } from '../src/core/marks'
import {
  manualEdges,
  mustInclude,
  pinnedFirst,
  pinnedLast,
  selectedId,
  settings,
  tracklist,
} from '../src/stores'
import { redoOnce, resetUndo, startUndo, undoOnce, withOneUndoStep } from '../src/lib/undoStore'

describe('undo wiring (v12 WS9/WS14)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    manualEdges.set([])
    tracklist.set([])
    selectedId.set(null)
    mustInclude.set([])
    pinnedFirst.set(null)
    pinnedLast.set(null)
    startUndo()
    resetUndo()
  })

  afterEach(() => vi.useRealTimers())

  test('a manual-edge toggle is undoable and redoable', () => {
    manualEdges.set([{ a: 'x', b: 'y' }])
    manualEdges.set([])
    undoOnce()
    expect(get(manualEdges)).toEqual([{ a: 'x', b: 'y' }])
    undoOnce()
    expect(get(manualEdges)).toEqual([])
    redoOnce()
    expect(get(manualEdges)).toEqual([{ a: 'x', b: 'y' }])
  })

  test('a star mark is undoable and redoable', () => {
    mustInclude.set(['x'])
    mustInclude.set(['x', 'y'])
    undoOnce()
    expect(get(mustInclude)).toEqual(['x'])
    undoOnce()
    expect(get(mustInclude)).toEqual([])
    redoOnce()
    expect(get(mustInclude)).toEqual(['x'])
  })

  test('a pin is undoable', () => {
    pinnedFirst.set('x')
    undoOnce()
    expect(get(pinnedFirst)).toBeNull()
  })

  test('a scoped bulk clear touching mustInclude and both pins is a single undo step, redoable too (v18 #3, Task 8)', () => {
    // Mark up some state, then re-baseline: only the CLEAR itself is under test.
    mustInclude.set(['x', 'y'])
    pinnedFirst.set('x')
    pinnedLast.set('y')
    resetUndo()

    // The Advanced-menu button's own sequence: compute the scoped result,
    // then write all three stores. Without withOneUndoStep, three separate
    // .set() calls to three separate stores record three separate steps
    // (Svelte's classic stores notify per-store, synchronously — nothing
    // coalesces three back-to-back top-level writes the way the debounce
    // below coalesces a tuning burst), so one Cmd+Z would only undo the
    // last of the three.
    const scope = new Set(['x', 'y'])
    const result = clearStarsInScope(scope, get(mustInclude), get(pinnedFirst), get(pinnedLast))
    withOneUndoStep(() => {
      mustInclude.set(result.mustInclude)
      pinnedFirst.set(result.pinnedFirst)
      pinnedLast.set(result.pinnedLast)
    })
    expect(get(mustInclude)).toEqual([])
    expect(get(pinnedFirst)).toBeNull()
    expect(get(pinnedLast)).toBeNull()

    undoOnce()
    expect(get(mustInclude)).toEqual(['x', 'y'])
    expect(get(pinnedFirst)).toBe('x')
    expect(get(pinnedLast)).toBe('y')

    // One Cmd+Shift+Z re-applies the whole clear, same as any other step.
    redoOnce()
    expect(get(mustInclude)).toEqual([])
    expect(get(pinnedFirst)).toBeNull()
    expect(get(pinnedLast)).toBeNull()
  })

  test('withOneUndoStep rolls back every store fn touched if fn throws partway, and re-throws (review fix)', () => {
    mustInclude.set(['x'])
    pinnedFirst.set(null)
    pinnedLast.set(null)
    resetUndo() // baseline: mustInclude=['x'], no pins, no history

    expect(() =>
      withOneUndoStep(() => {
        mustInclude.set(['x', 'y']) // this write "succeeds" before the throw
        pinnedFirst.set('boom')
        throw new Error('simulated failure mid-edit')
      }),
    ).toThrow('simulated failure mid-edit')

    // Rolled back to the EXACT pre-call values — not left at fn's partial
    // write. Without the fix, mustInclude stays ['x', 'y'] and pinnedFirst
    // stays 'boom' here: applying is reset (finally runs) but nothing
    // restores the stores themselves.
    expect(get(mustInclude)).toEqual(['x'])
    expect(get(pinnedFirst)).toBeNull()
    expect(get(pinnedLast)).toBeNull()

    // Nothing was recorded either: there is nothing to undo TO, so undoOnce
    // is a genuine no-op rather than resurfacing an unrelated older step.
    undoOnce()
    expect(get(mustInclude)).toEqual(['x'])
    expect(get(pinnedFirst)).toBeNull()
    expect(get(pinnedLast)).toBeNull()
  })

  test('a settings change is undoable after the debounce window', () => {
    const before = get(settings).edgeOpacity
    settings.update((s) => ({ ...s, edgeOpacity: 0.9 }))
    vi.advanceTimersByTime(500)
    undoOnce()
    expect(get(settings).edgeOpacity).toBe(before)
  })

  test('toggling audio preview is not an undo step (v28)', () => {
    // Undo already skips chrome. Cmd+Z pressed for something else must not
    // tear down a live AudioContext and stop the music as a side effect.
    settings.update((s) => ({ ...s, edgeOpacity: 0.7 }))
    vi.advanceTimersByTime(500)
    settings.update((s) => ({ ...s, audioPreview: true }))
    vi.advanceTimersByTime(500)
    undoOnce()
    expect(get(settings).audioPreview).toBe(true)
    expect(get(settings).edgeOpacity).not.toBe(0.7)
  })
})
