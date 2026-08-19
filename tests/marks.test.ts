import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { EMPTY_FILTERS, NOT_IN_PLAYLIST } from '../src/core/filter'
import {
  bulkScopeIds,
  clearCombosInScope,
  clearStarsInScope,
  comboIdSet,
  isPanelFilterKey,
  MARK_FILTERS,
  PANEL_FILTER_KEYS,
  PANEL_FILTERS,
  starredIdSet,
  type PanelFilterKey,
} from '../src/core/marks'
import type { ManualEdge, Playlist } from '../src/core/model'
import { DEFAULT_SETTINGS } from '../src/core/settings'
import { clearPanelFilter, filters, setMarkFilter, settings, toggleMarkFilter } from '../src/stores'
import { track } from './helpers'

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

describe('PANEL_FILTER_KEYS / isPanelFilterKey (v23: the permanent panel rows)', () => {
  test('the three pseudo-keys are starred, combos and keys, in that order', () => {
    expect(PANEL_FILTER_KEYS).toEqual(['starred', 'combos', 'keys'])
  })

  test('recognizes only the three pseudo-keys', () => {
    const keys: PanelFilterKey[] = ['starred', 'combos', 'keys']
    for (const k of keys) expect(isPanelFilterKey(k)).toBe(true)
    expect(isPanelFilterKey('bpm')).toBe(false)
    expect(isPanelFilterKey('nonsense')).toBe(false)
    expect(isPanelFilterKey('')).toBe(false)
  })
})

describe('PANEL_FILTERS (v23: the permanent panel rows)', () => {
  test('exactly three rows, in registry order', () => {
    expect(PANEL_FILTERS.map((m) => m.key)).toEqual(['starred', 'combos', 'keys'])
  })

  test('every row has a non-empty label and aria string', () => {
    for (const m of PANEL_FILTERS) {
      expect(m.label.length).toBeGreaterThan(0)
      expect(m.aria.length).toBeGreaterThan(0)
    }
  })

  test('every label puts the glyph first — a fixed-width column clips from the right', () => {
    for (const m of PANEL_FILTERS) {
      expect(m.label.startsWith('★') || m.label.startsWith('🔗') || m.label.startsWith('🎵')).toBe(
        true,
      )
    }
  })

  test('every aria string carries no emoji (a screen reader speaks its Unicode name otherwise)', () => {
    for (const m of PANEL_FILTERS) {
      expect(m.aria).not.toMatch(/[★🔗🎵]/u)
    }
  })

  test("only 'keys' has no marks flag — it drives filters.keyRings instead", () => {
    const withoutFlag = PANEL_FILTERS.filter((m) => m.flag === undefined).map((m) => m.key)
    expect(withoutFlag).toEqual(['keys'])
  })
})

describe('MARK_FILTERS (v18 #3/#8 review fix, B2 — derived from PANEL_FILTERS since v23)', () => {
  test('is exactly the two flagged rows, in order, v18 labels unchanged', () => {
    expect(MARK_FILTERS).toEqual([
      { key: 'starred', label: '★ Starred', aria: 'Starred', flag: 'starredOnly' },
      { key: 'combos', label: '🔗 Combos', aria: 'Manual combos', flag: 'comboOnly' },
    ])
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

describe('clearPanelFilter (v23)', () => {
  beforeEach(() => {
    filters.set(structuredClone(EMPTY_FILTERS))
    settings.set(structuredClone(DEFAULT_SETTINGS))
  })
  afterEach(() => {
    filters.set(structuredClone(EMPTY_FILTERS))
    settings.set(structuredClone(DEFAULT_SETTINGS))
  })

  test("'starred' turns the starredOnly marks flag off when it was on", () => {
    filters.update((f) => ({ ...f, marks: { ...f.marks, starredOnly: true } }))
    clearPanelFilter('starred')
    expect(get(filters).marks.starredOnly).toBe(false)
  })

  test("'combos' turns the comboOnly marks flag off when it was on", () => {
    filters.update((f) => ({ ...f, marks: { ...f.marks, comboOnly: true } }))
    clearPanelFilter('combos')
    expect(get(filters).marks.comboOnly).toBe(false)
  })

  test("'keys' resets keyRings to both-on when either ring is off", () => {
    filters.update((f) => ({ ...f, keyRings: { minor: true, major: false } }))
    clearPanelFilter('keys')
    expect(get(filters).keyRings).toEqual({ minor: true, major: true })
  })

  test("'keys' is a no-op (no filters emission) when keyRings is already both-on", () => {
    let emits = 0
    const unsubscribe = filters.subscribe(() => {
      emits += 1
    })
    const afterSubscribe = emits // the initial synchronous push on subscribe

    clearPanelFilter('keys') // EMPTY_FILTERS already has both rings on

    expect(emits).toBe(afterSubscribe)
    unsubscribe()
  })
})

describe('bulkScopeIds (v18 #3, Task 8)', () => {
  const library = [track({ id: 'a' }), track({ id: 'b' }), track({ id: 'c' })]
  const playlists: Playlist[] = [{ name: 'Openers', trackIds: ['a', 'b'] }]

  test('a null selection (playlist filter inactive) falls back to the whole library', () => {
    expect(bulkScopeIds(library, null, playlists)).toEqual(new Set(['a', 'b', 'c']))
  })

  test('an empty selection ALSO falls back to the whole library — unlike applyPlaylistFilter, where [] means "nothing"', () => {
    expect(bulkScopeIds(library, [], playlists)).toEqual(new Set(['a', 'b', 'c']))
  })

  test('a real selection scopes to just the chosen playlists members', () => {
    expect(bulkScopeIds(library, ['Openers'], playlists)).toEqual(new Set(['a', 'b']))
  })

  test('honours the NOT_IN_PLAYLIST pseudo-entry, same as applyPlaylistFilter', () => {
    expect(bulkScopeIds(library, [NOT_IN_PLAYLIST], playlists)).toEqual(new Set(['c']))
  })

  test('a selection with no imported playlists is inert — the whole library either way', () => {
    expect(bulkScopeIds(library, ['Openers'], [])).toEqual(new Set(['a', 'b', 'c']))
  })
})

describe('clearStarsInScope (v18 #3, Task 8)', () => {
  test('drops only the must-include ids that are in scope', () => {
    const result = clearStarsInScope(new Set(['a', 'b']), ['a', 'b', 'c'], null, null)
    expect(result.mustInclude).toEqual(['c'])
    expect(result.cleared).toBe(2)
  })

  test('leaves out-of-scope stars (must-include and pin alike) untouched', () => {
    const result = clearStarsInScope(new Set(['a']), ['a', 'z'], 'z', null)
    expect(result.mustInclude).toEqual(['z'])
    expect(result.pinnedFirst).toBe('z')
    expect(result.cleared).toBe(1)
  })

  test('clears a pin only when the pinned track itself is in scope', () => {
    const result = clearStarsInScope(new Set(['first-id']), [], 'first-id', 'last-id')
    expect(result.pinnedFirst).toBeNull()
    expect(result.pinnedLast).toBe('last-id')
    expect(result.cleared).toBe(1)
  })

  test('a track that is both must-include and a pin counts once, not twice', () => {
    const result = clearStarsInScope(new Set(['b']), ['b'], 'b', null)
    expect(result.mustInclude).toEqual([])
    expect(result.pinnedFirst).toBeNull()
    expect(result.cleared).toBe(1)
  })

  test('an empty scope clears nothing', () => {
    const result = clearStarsInScope(new Set(), ['a', 'b'], 'a', 'b')
    expect(result).toEqual({
      mustInclude: ['a', 'b'],
      pinnedFirst: 'a',
      pinnedLast: 'b',
      cleared: 0,
    })
  })
})

describe('clearCombosInScope (v18 #3, Task 8)', () => {
  const edges: ManualEdge[] = [
    { a: 'x', b: 'y' },
    { a: 'y', b: 'z' },
    { a: 'p', b: 'q' },
  ]

  test('removes an edge when EITHER endpoint is in scope', () => {
    const result = clearCombosInScope(new Set(['z']), edges)
    expect(result.edges).toEqual([
      { a: 'x', b: 'y' },
      { a: 'p', b: 'q' },
    ])
    expect(result.cleared).toBe(1)
  })

  test('an edge with both endpoints in scope is still removed and counted once', () => {
    const result = clearCombosInScope(new Set(['x', 'y']), edges)
    expect(result.edges).toEqual([{ a: 'p', b: 'q' }])
    expect(result.cleared).toBe(2) // {x,y} and {y,z} both touch the scope
  })

  test('an edge with neither endpoint in scope survives', () => {
    const result = clearCombosInScope(new Set(['q']), edges)
    expect(result.edges).toEqual([
      { a: 'x', b: 'y' },
      { a: 'y', b: 'z' },
    ])
    expect(result.cleared).toBe(1)
  })

  test('an empty scope clears nothing', () => {
    const result = clearCombosInScope(new Set(), edges)
    expect(result.edges).toEqual(edges)
    expect(result.cleared).toBe(0)
  })
})
