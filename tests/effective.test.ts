import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { DEFAULT_CRITERIA } from '../src/core/combos'
import { EMPTY_FILTERS } from '../src/core/filter'
import { DEFAULT_SETTINGS } from '../src/core/settings'
import {
  criteria,
  effectiveCriteria,
  effectiveFilters,
  effectiveManualEdges,
  effectiveSettings,
  filters,
  manualEdges,
  settings,
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
  })
  afterEach(() => {
    criteria.set(structuredClone(DEFAULT_CRITERIA))
    filters.set(structuredClone(EMPTY_FILTERS))
    settings.set(structuredClone(DEFAULT_SETTINGS))
    manualEdges.set([])
  })

  test('in advanced, effective stores pass the raw stores through unchanged', () => {
    settings.update((s) => ({ ...s, uiMode: 'advanced', edgeOpacity: 0.9 }))
    criteria.update((c) => ({ ...c, threshold: 1 }))
    filters.update((f) => ({ ...f, keyRing: 'minor' }))
    manualEdges.set([{ a: 'x', b: 'y' }])

    expect(get(effectiveSettings)).toEqual(get(settings))
    expect(get(effectiveCriteria)).toEqual(get(criteria))
    expect(get(effectiveFilters)).toEqual(get(filters))
    expect(get(effectiveManualEdges)).toEqual([{ a: 'x', b: 'y' }])
  })

  test('easy ⇒ effectiveCriteria deep-equals DEFAULT_CRITERIA despite mutations', () => {
    criteria.update((c) => ({
      ...c,
      threshold: 1,
      key: { ...c.key, enabled: false },
      genre: { ...c.genre, k: 99 },
    }))
    settings.update((s) => ({ ...s, uiMode: 'easy' }))

    expect(get(effectiveCriteria)).toEqual(DEFAULT_CRITERIA)
  })

  test('easy effectiveCriteria is a fresh clone — not aliased to DEFAULT_CRITERIA', () => {
    settings.update((s) => ({ ...s, uiMode: 'easy' }))
    const eff = get(effectiveCriteria)
    expect(eff).not.toBe(DEFAULT_CRITERIA)
    expect(eff.key).not.toBe(DEFAULT_CRITERIA.key)
  })

  test('easy ⇒ effectiveFilters keeps playlists but resets properties/genres/keyRing', () => {
    filters.set({
      properties: { bpm: [120, 130] },
      genres: ['house'],
      playlists: ['Warmup', 'Peak'],
      keyRing: 'major',
    })
    settings.update((s) => ({ ...s, uiMode: 'easy' }))

    const eff = get(effectiveFilters)
    expect(eff.playlists).toEqual(['Warmup', 'Peak'])
    expect(eff.properties).toEqual(EMPTY_FILTERS.properties)
    expect(eff.genres).toEqual(EMPTY_FILTERS.genres)
    expect(eff.keyRing).toEqual(EMPTY_FILTERS.keyRing)
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
      keyRing: 'major' as const,
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
    expect(get(effectiveCriteria)).toEqual(DEFAULT_CRITERIA)
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
})
