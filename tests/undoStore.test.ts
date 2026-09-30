import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { clearStarsInScope } from '../src/core/marks'
import {
  activeSet,
  manualEdges,
  mustInclude,
  patchActiveSet,
  pinnedFirst,
  pinnedLast,
  selectedId,
  setGeneratedTracklist,
  settings,
  tracklist,
} from '../src/stores'
import { redoOnce, resetUndo, startUndo, undoOnce } from '../src/lib/undoStore'

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

  test('a scoped bulk clear of ★ and both pins is a single undo step, redoable too', () => {
    // Mark up some state, then re-baseline: only the CLEAR itself is under test.
    patchActiveSet({ mustInclude: ['x', 'y'], pinnedFirst: 'x', pinnedLast: 'y' })
    resetUndo()

    // The Advanced-menu button's own sequence: compute the scoped result, then
    // write it to the active set in one patch.
    const scope = new Set(['x', 'y'])
    const result = clearStarsInScope(scope, get(mustInclude), get(pinnedFirst), get(pinnedLast))
    patchActiveSet({
      mustInclude: result.mustInclude,
      pinnedFirst: result.pinnedFirst,
      pinnedLast: result.pinnedLast,
    })
    expect(get(mustInclude)).toEqual([])

    undoOnce()
    expect(get(mustInclude)).toEqual(['x', 'y'])
    expect(get(pinnedFirst)).toBe('x')
    expect(get(pinnedLast)).toBe('y')

    redoOnce()
    expect(get(mustInclude)).toEqual([])
    expect(get(pinnedFirst)).toBeNull()
    expect(get(pinnedLast)).toBeNull()
  })

  test('undo restores a star on the set it was made on, not the generated flag', () => {
    setGeneratedTracklist(['a', 'b'])
    resetUndo()
    mustInclude.set(['a'])
    undoOnce()
    expect(get(mustInclude)).toEqual([])
    expect(get(activeSet).generated).toBe(true)
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
