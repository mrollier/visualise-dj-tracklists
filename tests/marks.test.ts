import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { EMPTY_FILTERS } from '../src/core/filter'
import {
  comboIdSet,
  isMarkFilterKey,
  MARK_FILTER_KEYS,
  MARK_FILTERS,
  starredIdSet,
  type MarkFilterKey,
} from '../src/core/marks'
import type { ManualEdge } from '../src/core/model'
import { DEFAULT_SETTINGS } from '../src/core/settings'
import { filters, setMarkFilter, settings, toggleMarkFilter } from '../src/stores'

describe('starredIdSet (v18 #3/#8)', () => {
  test('collects must-include ids, deduped', () => {
    expect(starredIdSet(['a', 'b', 'a'], null, null)).toEqual(new Set(['a', 'b']))
  })

  test('includes both pins even when neither is in must-include', () => {
    expect(starredIdSet([], 'first-id', 'last-id')).toEqual(new Set(['first-id', 'last-id']))
  })

  test('unions must-include and the pins, deduping an id that is both', () => {
    expect(starredIdSet(['a', 'b'], 'b', 'c')).toEqual(new Set(['a', 'b', 'c']))
  })

  test('null pins and an empty must-include yield an empty set', () => {
    expect(starredIdSet([], null, null)).toEqual(new Set())
  })
})

describe('comboIdSet (v18 #3/#8)', () => {
  const edges: ManualEdge[] = [
    { a: 'x', b: 'y' },
    { a: 'y', b: 'z', tag: 'mashup' },
  ]

  test('collects both endpoints of every edge, deduped', () => {
    expect(comboIdSet(edges)).toEqual(new Set(['x', 'y', 'z']))
  })

  test('no edges yields an empty set', () => {
    expect(comboIdSet([])).toEqual(new Set())
  })
})

describe('MARK_FILTER_KEYS / isMarkFilterKey (v18 #3/#8)', () => {
  test('the two pseudo-keys are starred and combos, in that order', () => {
    expect(MARK_FILTER_KEYS).toEqual(['starred', 'combos'])
  })

  test('recognizes only the two pseudo-keys', () => {
    const keys: MarkFilterKey[] = ['starred', 'combos']
    for (const k of keys) expect(isMarkFilterKey(k)).toBe(true)
    expect(isMarkFilterKey('bpm')).toBe(false)
    expect(isMarkFilterKey('nonsense')).toBe(false)
    expect(isMarkFilterKey('')).toBe(false)
  })
})

describe('MARK_FILTERS (v18 #3/#8 review fix, B2)', () => {
  test('keys match MARK_FILTER_KEYS, same order — the two registries cannot drift apart', () => {
    expect(MARK_FILTERS.map((m) => m.key)).toEqual(MARK_FILTER_KEYS)
  })

  test('every label puts the glyph first — a fixed-width column clips from the right', () => {
    for (const m of MARK_FILTERS) {
      expect(m.label.startsWith('★') || m.label.startsWith('🔗')).toBe(true)
    }
  })

  test('every aria string carries no emoji (a screen reader speaks its Unicode name otherwise)', () => {
    for (const m of MARK_FILTERS) {
      expect(m.aria).not.toMatch(/[★🔗]/u)
    }
  })
})

describe('setMarkFilter / toggleMarkFilter (v18 #3/#8 review fix, B1)', () => {
  beforeEach(() => {
    filters.set(structuredClone(EMPTY_FILTERS))
    settings.set(structuredClone(DEFAULT_SETTINGS))
  })
  afterEach(() => {
    filters.set(structuredClone(EMPTY_FILTERS))
    settings.set(structuredClone(DEFAULT_SETTINGS))
  })

  test('is a no-op when the value already matches — no filters emission', () => {
    let emits = 0
    const unsubscribe = filters.subscribe(() => {
      emits += 1
    })
    const afterSubscribe = emits // the initial synchronous push on subscribe

    setMarkFilter('starredOnly', false) // EMPTY_FILTERS already has it false

    expect(emits).toBe(afterSubscribe)
    unsubscribe()
  })

  test('writes and emits when the value actually changes', () => {
    let emits = 0
    const unsubscribe = filters.subscribe(() => {
      emits += 1
    })
    const afterSubscribe = emits

    setMarkFilter('starredOnly', true)

    expect(emits).toBeGreaterThan(afterSubscribe)
    expect(get(filters).marks.starredOnly).toBe(true)
    unsubscribe()
  })

  test('turning a flag ON adds its row to visibleFilters if missing (A3: an active filter is never invisible)', () => {
    settings.update((s) => ({ ...s, visibleFilters: [] }))
    setMarkFilter('starredOnly', true)
    expect(get(settings).visibleFilters).toContain('starred')
  })

  test('turning a flag ON does not duplicate an already-visible row', () => {
    settings.update((s) => ({ ...s, visibleFilters: ['starred'] }))
    setMarkFilter('starredOnly', true)
    expect(get(settings).visibleFilters.filter((k) => k === 'starred')).toHaveLength(1)
  })

  test('turning a flag OFF never touches visibleFilters — row visibility and active state are independent', () => {
    settings.update((s) => ({ ...s, visibleFilters: ['starred'] }))
    filters.update((f) => ({ ...f, marks: { ...f.marks, starredOnly: true } }))
    setMarkFilter('starredOnly', false)
    expect(get(settings).visibleFilters).toEqual(['starred'])
  })

  test('toggleMarkFilter flips the current value', () => {
    toggleMarkFilter('comboOnly')
    expect(get(filters).marks.comboOnly).toBe(true)
    toggleMarkFilter('comboOnly')
    expect(get(filters).marks.comboOnly).toBe(false)
  })
})
