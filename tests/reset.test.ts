import { describe, expect, test } from 'vitest'
import { DEFAULT_CRITERIA, type CriteriaConfig } from '../src/core/combos'
import { EMPTY_FILTERS } from '../src/core/filter'
import { resetAdvancedCriteria, resetAdvancedSettings } from '../src/core/reset'
import { DEFAULT_SETTINGS, type AppSettings } from '../src/core/settings'

describe('reset to defaults (v9 issue 3)', () => {
  test('settings reset wholesale — except the theme and the section memory', () => {
    const current: AppSettings = {
      ...structuredClone(DEFAULT_SETTINGS),
      theme: 'light',
      colorScheme: 'violet',
      edgeOpacity: 0.8,
      focusClusterEdges: true,
      manualEdgeWeight: 9,
      hiddenColumns: [],
      advancedOpen: ['display', 'tracks'],
    }
    const reset = resetAdvancedSettings(current, EMPTY_FILTERS)
    expect(reset.colorScheme).toBe(DEFAULT_SETTINGS.colorScheme)
    expect(reset.edgeOpacity).toBe(DEFAULT_SETTINGS.edgeOpacity)
    expect(reset.focusClusterEdges).toBe(false)
    expect(reset.manualEdgeWeight).toBe(DEFAULT_SETTINGS.manualEdgeWeight)
    expect(reset.hiddenColumns).toEqual(DEFAULT_SETTINGS.hiddenColumns)
    // The theme lives in the top bar and the fold memory is UI chrome —
    // neither is an "advanced setting value".
    expect(reset.theme).toBe('light')
    expect(reset.advancedOpen).toEqual(['display', 'tracks'])
  })

  test('audio preview survives a reset, like the theme (v28)', () => {
    // Silently unlinking someone's music folder from "return to defaults" is
    // the same class of surprise as flipping their theme.
    const current: AppSettings = { ...structuredClone(DEFAULT_SETTINGS), audioPreview: true }
    expect(resetAdvancedSettings(current, EMPTY_FILTERS).audioPreview).toBe(true)
  })

  test('collapsed panels survive a reset, like the theme (v30)', () => {
    // Re-opening panels someone deliberately put away is the same surprise as
    // flipping their theme back.
    const current: AppSettings = {
      ...structuredClone(DEFAULT_SETTINGS),
      showLeftPanel: false,
      showRightPanel: false,
    }
    const reset = resetAdvancedSettings(current, EMPTY_FILTERS)
    expect(reset.showLeftPanel).toBe(false)
    expect(reset.showRightPanel).toBe(false)
  })

  test('restores all three permanent panel rows (v23)', () => {
    const current: AppSettings = {
      ...structuredClone(DEFAULT_SETTINGS),
      visibleFilters: ['bpm'], // starred/combos/keys hidden
    }
    const reset = resetAdvancedSettings(current, EMPTY_FILTERS)
    expect(reset.visibleFilters).toEqual(expect.arrayContaining(['starred', 'combos', 'keys']))
  })

  test('criteria reset only the advanced-panel-owned fields', () => {
    const current: CriteriaConfig = structuredClone(DEFAULT_CRITERIA)
    current.key = {
      ...current.key,
      enabled: false,
      plusTwo: true,
      plusSeven: true,
      vinylMode: true,
    }
    current.bpm = { ...current.bpm, maxPercent: 0, unitTime: false, halfDouble: true }
    current.energy = { ...current.energy, enabled: false, maxSteps: 9 }
    current.genre = { ...current.genre, enabled: false, k: 8 }
    current.threshold = 4

    const reset = resetAdvancedCriteria(current)
    // Advanced-owned toggles go back to defaults…
    expect(reset.key.plusTwo).toBe(DEFAULT_CRITERIA.key.plusTwo)
    expect(reset.key.plusSeven).toBe(DEFAULT_CRITERIA.key.plusSeven)
    expect(reset.key.vinylMode).toBe(DEFAULT_CRITERIA.key.vinylMode)
    expect(reset.bpm.unitTime).toBe(DEFAULT_CRITERIA.bpm.unitTime)
    expect(reset.bpm.halfDouble).toBe(DEFAULT_CRITERIA.bpm.halfDouble)
    expect(reset.genre.k).toBe(DEFAULT_CRITERIA.genre.k)
    // …but the combo panel's own knobs are untouched. Energy has no
    // advanced-owned sub-fields (same as year), so it's untouched wholesale.
    expect(reset.key.enabled).toBe(false)
    expect(reset.bpm.maxPercent).toBe(0)
    expect(reset.energy).toEqual({ enabled: false, maxSteps: 9, demanded: false })
    expect(reset.genre.enabled).toBe(false)
    expect(reset.threshold).toBe(4)
  })

  test('neither reset mutates its input', () => {
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.colorScheme = 'aqua'
    const criteria = structuredClone(DEFAULT_CRITERIA)
    criteria.genre.k = 9
    resetAdvancedSettings(settings, EMPTY_FILTERS)
    resetAdvancedCriteria(criteria)
    expect(settings.colorScheme).toBe('aqua')
    expect(criteria.genre.k).toBe(9)
  })
})

describe('reset never leaves a filter acting from a hidden row', () => {
  test('rows still filtering stay visible after the reset', () => {
    const current: AppSettings = {
      ...structuredClone(DEFAULT_SETTINGS),
      visibleFilters: ['energy'],
    }
    const filters = {
      ...structuredClone(EMPTY_FILTERS),
      properties: { energy: [5, 8] as [number, number] },
      marks: { starredOnly: true, comboOnly: false, constellationOnly: false },
    }
    const reset = resetAdvancedSettings(current, filters)
    expect(reset.visibleFilters).toEqual(expect.arrayContaining(['energy', 'starred']))
  })
})
