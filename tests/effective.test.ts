import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { DEFAULT_CRITERIA, EASY_CRITERIA } from '../src/core/combos'
import { EMPTY_FILTERS } from '../src/core/filter'
import { DEFAULT_SETTINGS } from '../src/core/settings'
import { SAMPLE_TRACKS } from '../src/data/sample-tracks'
import {
  criteria,
  effectiveCriteria,
  effectiveFilters,
  effectiveManualEdges,
  effectiveSettings,
  filters,
  library,
  manualEdges,
  mustInclude,
  pinnedFirst,
  pinnedLast,
  settings,
  visibleLibrary,
} from '../src/stores'

// v14 WS6 (E1): easy mode COMPUTES WITH defaults through a derived layer;
// the raw writables (which feed persist + undo) must never be mutated by it,
// so flipping back to advanced returns every stored value untouched.
describe('effective stores — easy mode computes with defaults', () => {
  beforeEach(() => {
    criteria.set(structuredClone(DEFAULT_CRITERIA))
    filters.set(structuredClone(EMPTY_FILTERS))
    settings.set(structuredClone(DEFAULT_SETTINGS))
    manualEdges.set([])
    library.set([])
  })
  afterEach(() => {
    criteria.set(structuredClone(DEFAULT_CRITERIA))
    filters.set(structuredClone(EMPTY_FILTERS))
    settings.set(structuredClone(DEFAULT_SETTINGS))
    manualEdges.set([])
    library.set([])
  })

  test('in advanced, effective stores pass the raw stores through unchanged', () => {
    settings.update((s) => ({ ...s, uiMode: 'advanced', edgeOpacity: 0.9 }))
    criteria.update((c) => ({ ...c, threshold: 1 }))
    filters.update((f) => ({ ...f, keyRings: { minor: true, major: false } }))
    manualEdges.set([{ a: 'x', b: 'y' }])

    expect(get(effectiveSettings)).toEqual(get(settings))
    expect(get(effectiveCriteria)).toEqual(get(criteria))
    expect(get(effectiveFilters)).toEqual(get(filters))
    expect(get(effectiveManualEdges)).toEqual([{ a: 'x', b: 'y' }])
  })

  test('easy ⇒ effectiveCriteria deep-equals EASY_CRITERIA despite mutations', () => {
    criteria.update((c) => ({
      ...c,
      threshold: 1,
      key: { ...c.key, enabled: false },
      genre: { ...c.genre, k: 99 },
    }))
    settings.update((s) => ({ ...s, uiMode: 'easy' }))

    expect(get(effectiveCriteria)).toEqual(EASY_CRITERIA)
  })

  // v15: easy mode's fixed criteria are key + BPM only, both required —
  // genre and year (DEFAULT_CRITERIA's other two enabled fields) are too
  // loose for a hands-off default.
  test('easy criteria require key AND bpm, with genre/year disabled', () => {
    settings.update((s) => ({ ...s, uiMode: 'easy' }))
    const eff = get(effectiveCriteria)
    expect(eff.key.enabled).toBe(true)
    expect(eff.bpm.enabled).toBe(true)
    expect(eff.genre.enabled).toBe(false)
    expect(eff.year.enabled).toBe(false)
    expect(eff.threshold).toBe(2)
  })

  test('easy effectiveCriteria is a fresh clone — not aliased to EASY_CRITERIA', () => {
    settings.update((s) => ({ ...s, uiMode: 'easy' }))
    const eff = get(effectiveCriteria)
    expect(eff).not.toBe(EASY_CRITERIA)
    expect(eff.key).not.toBe(EASY_CRITERIA.key)
  })

  test('easy ⇒ effectiveFilters keeps playlists but resets properties/genres/keyRings/marks', () => {
    filters.set({
      properties: { bpm: [120, 130] },
      genres: ['house'],
      playlists: ['Warmup', 'Peak'],
      keyRings: { minor: false, major: true },
      marks: { starredOnly: true, comboOnly: true },
    })
    settings.update((s) => ({ ...s, uiMode: 'easy' }))

    const eff = get(effectiveFilters)
    expect(eff.playlists).toEqual(['Warmup', 'Peak'])
    expect(eff.properties).toEqual(EMPTY_FILTERS.properties)
    expect(eff.genres).toEqual(EMPTY_FILTERS.genres)
    expect(eff.keyRings).toEqual(EMPTY_FILTERS.keyRings)
    // v18 (#3/#8): easy mode is a second, independent reason marks read as
    // inert — on top of migrateFilters always loading them off.
    expect(eff.marks).toEqual(EMPTY_FILTERS.marks)
  })

  test('easy ⇒ effectiveManualEdges is []', () => {
    manualEdges.set([
      { a: 'x', b: 'y' },
      { a: 'p', b: 'q' },
    ])
    settings.update((s) => ({ ...s, uiMode: 'easy' }))

    expect(get(effectiveManualEdges)).toEqual([])
  })

  test('easy ⇒ effectiveSettings resets values but keeps chrome (theme, uiMode, advancedOpen)', () => {
    settings.set({
      ...structuredClone(DEFAULT_SETTINGS),
      theme: 'light',
      advancedOpen: ['display', 'tracks'],
      edgeOpacity: 0.9,
      slotSpreadFactor: 0.2,
      manualEdgeWeight: 9,
      uiMode: 'easy',
    })

    const eff = get(effectiveSettings)
    expect(eff.edgeOpacity).toBe(DEFAULT_SETTINGS.edgeOpacity)
    expect(eff.slotSpreadFactor).toBe(DEFAULT_SETTINGS.slotSpreadFactor)
    expect(eff.manualEdgeWeight).toBe(DEFAULT_SETTINGS.manualEdgeWeight)
    // Chrome fields ride through untouched.
    expect(eff.theme).toBe('light')
    expect(eff.uiMode).toBe('easy')
    expect(eff.advancedOpen).toEqual(['display', 'tracks'])
  })

  test('easy never mutates the stored writables; flipping back restores them untouched', () => {
    const storedCriteria = { ...structuredClone(DEFAULT_CRITERIA), threshold: 1 }
    const storedFilters = {
      properties: { bpm: [120, 130] as [number, number] },
      genres: ['house'],
      playlists: ['Peak'],
      keyRings: { minor: false, major: true },
      marks: { starredOnly: true, comboOnly: false },
    }
    const storedSettings = {
      ...structuredClone(DEFAULT_SETTINGS),
      edgeOpacity: 0.9,
      manualEdgeWeight: 9,
    }
    const storedEdges = [{ a: 'x', b: 'y' }]
    criteria.set(structuredClone(storedCriteria))
    filters.set(structuredClone(storedFilters))
    settings.set({ ...structuredClone(storedSettings), uiMode: 'advanced' })
    manualEdges.set(structuredClone(storedEdges))

    // Enter easy: effective layer swings to defaults…
    settings.update((s) => ({ ...s, uiMode: 'easy' }))
    expect(get(effectiveCriteria)).toEqual(EASY_CRITERIA)
    // …but the raw writables are untouched.
    expect(get(criteria)).toEqual(storedCriteria)
    expect(get(filters)).toEqual(storedFilters)
    expect(get(manualEdges)).toEqual(storedEdges)

    // Flip back: stored advanced values reappear exactly.
    settings.update((s) => ({ ...s, uiMode: 'advanced' }))
    expect(get(effectiveCriteria)).toEqual(storedCriteria)
    expect(get(effectiveFilters)).toEqual(storedFilters)
    expect(get(effectiveSettings)).toEqual({ ...storedSettings, uiMode: 'advanced' })
    expect(get(effectiveManualEdges)).toEqual(storedEdges)
  })

  // Pins the mechanism the ⚡ window-close (TracklistPanel drift guard) relies
  // on: it treats `$visibleLibrary` getting a fresh array identity as the
  // signal that a mode flip changed the inputs a force-suggestion was seeded
  // against. An active advanced filter makes the flip consequential — easy
  // resets properties/genres/keyRing, so the visible set actually changes,
  // not just its identity.
  test('uiMode flip gives visibleLibrary a new array identity both ways (v14 review finding)', () => {
    library.set(structuredClone(SAMPLE_TRACKS))
    filters.set({
      ...structuredClone(EMPTY_FILTERS),
      properties: { bpm: [120, 125] },
    })
    settings.update((s) => ({ ...s, uiMode: 'advanced' }))

    const advancedFirst = get(visibleLibrary)
    expect(advancedFirst.length).toBeLessThan(SAMPLE_TRACKS.length) // the bpm filter bites

    settings.update((s) => ({ ...s, uiMode: 'easy' }))
    const easy = get(visibleLibrary)
    expect(easy).not.toBe(advancedFirst)
    expect(easy.length).toBe(SAMPLE_TRACKS.length) // easy drops the properties filter

    settings.update((s) => ({ ...s, uiMode: 'advanced' }))
    const advancedSecond = get(visibleLibrary)
    expect(advancedSecond).not.toBe(easy)
    expect(advancedSecond.length).toBe(advancedFirst.length)
  })
})

// v18 (#3/#8): visibleLibrary feeds computeComboView, which is O(n²) — a
// naive dependency on mustInclude/pins/manualEdges would recompute the combo
// graph on every star click even with both marks flags off. marksContext
// (stores.ts) is gated through `distinct` so it only re-emits when the id
// SET it resolves actually changes, and stays `null` (inert) while both
// flags are off — this pins that mechanism at the visibleLibrary boundary.
describe('marksContext — perf gate (v18 #3/#8)', () => {
  beforeEach(() => {
    filters.set(structuredClone(EMPTY_FILTERS))
    library.set(structuredClone(SAMPLE_TRACKS))
    mustInclude.set([])
    pinnedFirst.set(null)
    pinnedLast.set(null)
    manualEdges.set([])
  })
  afterEach(() => {
    filters.set(structuredClone(EMPTY_FILTERS))
    library.set([])
    mustInclude.set([])
    pinnedFirst.set(null)
    pinnedLast.set(null)
    manualEdges.set([])
  })

  test('with both mark flags off, cycling mustInclude/pins/manualEdges does not re-emit visibleLibrary', () => {
    let emits = 0
    const unsubscribe = visibleLibrary.subscribe(() => {
      emits += 1
    })
    const afterSubscribe = emits // the initial synchronous push on subscribe

    mustInclude.set([SAMPLE_TRACKS[0].id])
    mustInclude.set([])
    mustInclude.set([SAMPLE_TRACKS[1].id, SAMPLE_TRACKS[0].id])
    pinnedFirst.set(SAMPLE_TRACKS[0].id)
    pinnedFirst.set(null)
    pinnedLast.set(SAMPLE_TRACKS[1].id)
    pinnedLast.set(null)
    manualEdges.set([{ a: SAMPLE_TRACKS[0].id, b: SAMPLE_TRACKS[1].id }])
    manualEdges.set([])

    expect(emits).toBe(afterSubscribe)
    unsubscribe()
  })

  test('turning starredOnly on makes visibleLibrary shrink to the starred ids and react to mustInclude', () => {
    filters.update((f) => ({ ...f, marks: { starredOnly: true, comboOnly: false } }))
    expect(get(visibleLibrary)).toEqual([]) // nothing starred yet — everything hides

    let emits = 0
    const unsubscribe = visibleLibrary.subscribe(() => {
      emits += 1
    })
    const afterSubscribe = emits

    mustInclude.set([SAMPLE_TRACKS[0].id])

    expect(emits).toBeGreaterThan(afterSubscribe)
    expect(get(visibleLibrary).map((t) => t.id)).toEqual([SAMPLE_TRACKS[0].id])
    unsubscribe()
  })

  // The two tests above don't actually pin `distinct`'s own contribution:
  // Svelte's own dedup already collapses null→null (both-off) transitions
  // regardless of `distinct`, and the "reacts" test only proves recompute
  // happens on a REAL content change. The scenario only `distinct` guards is
  // a recompute that lands back on a content-EQUAL but reference-DIFFERENT
  // MarksContext — e.g. mustInclude reordered to the same set. Without
  // `distinct`, Svelte's `safe_not_equal` treats any new object as "changed"
  // and would re-emit anyway.
  test('with starredOnly on, reordering mustInclude to the same id set does not re-emit visibleLibrary', () => {
    filters.update((f) => ({ ...f, marks: { starredOnly: true, comboOnly: false } }))
    mustInclude.set([SAMPLE_TRACKS[0].id, SAMPLE_TRACKS[1].id])
    expect(get(visibleLibrary).map((t) => t.id)).toEqual([SAMPLE_TRACKS[0].id, SAMPLE_TRACKS[1].id])

    let emits = 0
    const unsubscribe = visibleLibrary.subscribe(() => {
      emits += 1
    })
    const afterSubscribe = emits

    // Same SET, different order — a new array/Set reference, not a new member.
    mustInclude.set([SAMPLE_TRACKS[1].id, SAMPLE_TRACKS[0].id])

    expect(emits).toBe(afterSubscribe)
    unsubscribe()
  })
})
