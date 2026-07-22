import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  manualEdges,
  mustInclude,
  pinnedFirst,
  pinnedLast,
  selectedId,
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

  test('a settings change is undoable after the debounce window', () => {
    const before = get(settings).edgeOpacity
    settings.update((s) => ({ ...s, edgeOpacity: 0.9 }))
    vi.advanceTimersByTime(500)
    undoOnce()
    expect(get(settings).edgeOpacity).toBe(before)
  })
})
