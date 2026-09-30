import { DEFAULT_CRITERIA, type CriteriaConfig } from './combos'
import type { LibraryFilters } from './filter'
import { MARK_FILTERS } from './marks'
import type { TrackSortField } from './trackSort'
import { chromeOf, DEFAULT_SETTINGS, type AppSettings } from './settings'

/**
 * "Return to default settings": reset everything the Advanced panel owns and
 * nothing else — the chrome (theme, panels, fold memory, audio preview)
 * survives, and so does every filter row still in use: a hidden row could
 * not be cleared, and nothing may filter invisibly.
 */
export function resetAdvancedSettings(current: AppSettings, filters: LibraryFilters): AppSettings {
  const next = { ...structuredClone(DEFAULT_SETTINGS), ...chromeOf(current) }
  const inUse = [
    ...(Object.keys(filters.properties) as TrackSortField[]),
    ...MARK_FILTERS.filter((m) => filters.marks[m.flag]).map((m) => m.key),
    ...(filters.keyRings.minor && filters.keyRings.major ? [] : (['keys'] as const)),
  ]
  for (const key of inUse) if (!next.visibleFilters.includes(key)) next.visibleFilters.push(key)
  return next
}

/**
 * The criteria fields the Advanced panel controls (genre method/mode/k/
 * threshold, the key move toggles, the BPM metric ratios) go back to their
 * defaults; the combo panel's own knobs (enabled flags, BPM tolerance, year
 * window, N-of-M threshold) stay as they are.
 */
export function resetAdvancedCriteria(current: CriteriaConfig): CriteriaConfig {
  const defaults = structuredClone(DEFAULT_CRITERIA)
  return {
    ...current,
    key: {
      ...current.key,
      plusTwo: defaults.key.plusTwo,
      plusSeven: defaults.key.plusSeven,
      vinylMode: defaults.key.vinylMode,
    },
    bpm: {
      ...current.bpm,
      unitTime: defaults.bpm.unitTime,
      halfDouble: defaults.bpm.halfDouble,
      twoThirds: defaults.bpm.twoThirds,
    },
    genre: { ...current.genre, k: defaults.genre.k },
  }
}
