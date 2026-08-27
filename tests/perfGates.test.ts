import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DEFAULT_CRITERIA } from '../src/core/combos'
import { EMPTY_FILTERS } from '../src/core/filter'
import { DEFAULT_SETTINGS } from '../src/core/settings'
import {
  criteria,
  edges,
  filters,
  focusEdges,
  iconClasses,
  library,
  settings,
  slotSpreadFactor,
} from '../src/stores'
import { track } from './helpers'

// v37 perf gates: the O(n²) combo graph and the other heavy derivations must
// only recompute when an input they actually read changes — and criteria
// bursts (slider drags) must coalesce instead of recomputing per input event.
describe('perf gates (v37)', () => {
  beforeEach(() => {
    criteria.set(structuredClone(DEFAULT_CRITERIA))
    filters.set(structuredClone(EMPTY_FILTERS))
    settings.set(structuredClone(DEFAULT_SETTINGS))
    library.set([])
  })
  afterEach(() => {
    criteria.set(structuredClone(DEFAULT_CRITERIA))
    filters.set(structuredClone(EMPTY_FILTERS))
    settings.set(structuredClone(DEFAULT_SETTINGS))
    library.set([])
    vi.useRealTimers()
  })

  test('criteria writes throttle into the combo graph: leading + trailing', () => {
    vi.useFakeTimers()
    library.set([
      track({ id: 'a', genre: 'House', bpm: 124 }),
      track({ id: 'b', genre: 'House', bpm: 125 }),
    ])
    const seen: number[] = []
    const unsubscribe = edges.subscribe(($edges) => seen.push($edges.length))
    // Leave any throttle window left over from other subscriptions in this
    // module (the store is a singleton across the test file).
    vi.advanceTimersByTime(2000)
    const base = seen.length

    // Idle → the first write passes through synchronously.
    criteria.update((c) => ({ ...c, threshold: 1 }))
    expect(seen.length).toBe(base + 1)

    // A burst inside the window coalesces — no recompute per write…
    criteria.update((c) => ({ ...c, threshold: 2 }))
    criteria.update((c) => ({ ...c, threshold: 3 }))
    expect(seen.length).toBe(base + 1)

    // …and the trailing edge delivers exactly one recompute with the last value.
    vi.advanceTimersByTime(500)
    expect(seen.length).toBe(base + 2)
    unsubscribe()
  })

  test('an edge-opacity write never re-emits iconClasses or focusEdges', () => {
    library.set([track({ id: 'a', genre: 'House', key: '1A' })])
    let iconEmits = 0
    let focusEmits = 0
    const u1 = iconClasses.subscribe(() => iconEmits++)
    const u2 = focusEdges.subscribe(() => focusEmits++)
    const iconBase = iconEmits
    const focusBase = focusEmits

    settings.update((s) => ({ ...s, edgeOpacity: 0.42 }))
    expect(iconEmits).toBe(iconBase)
    expect(focusEmits).toBe(focusBase)

    u1()
    u2()
  })

  test('slotSpreadFactor ignores unrelated settings churn', () => {
    let emits = 0
    const unsubscribe = slotSpreadFactor.subscribe(() => emits++)
    const base = emits
    settings.update((s) => ({ ...s, edgeOpacity: 0.13 }))
    expect(emits).toBe(base)
    unsubscribe()
  })
})
