import type { TrackSortField } from './trackSort'

/**
 * Preferred BPM trajectory for generated sets (design-v6 §C): 'any' adds no
 * preference, 'sawtooth' builds up and drops back in cycles.
 */
export type BpmProgression = 'any' | 'steady' | 'rising' | 'falling' | 'sawtooth'

/**
 * Display / behaviour settings, adjustable in the Advanced menu and persisted
 * with the project. Anything that changes *what connects to what* lives in
 * CriteriaConfig or LibraryFilters instead — settings only shape presentation
 * and generation defaults.
 */
export interface AppSettings {
  /** Explicit theme choice; null = follow the system preference. */
  theme: 'light' | 'dark' | null
  /** Node colour scheme (per-theme ramps in scales.ts). */
  colorScheme: 'blue' | 'aqua' | 'violet'
  /**
   * Angular fan-out of same-key tracks as a 0–1 factor of the half-slot
   * window (±7.5°). Tracks are ordered within their slot by a stable
   * per-track hash of jitterSeed (issue 16), so angles never move under
   * filtering and survive reloads.
   */
  slotSpreadFactor: number
  /** Seed for the per-track fan order; the ↻ re-jitter button redraws it. */
  jitterSeed: number
  /** Base opacity of suggestion edges. */
  edgeOpacity: number
  /** Target number of tracks for the suggested-set generator. */
  suggestLength: number
  /** 0 = safest transitions, 1 = adventurous/dissonant sampling. */
  suggestRandomness: number
  /**
   * What the node shapes encode (v8 issues 4+5): curated genre FAMILIES
   * (deterministic, the default), the selected PLAYLISTS (first one wins),
   * or similarity CLUSTERS — always computed in the hybrid space, never
   * following the combo criterion's method.
   */
  iconMode: 'families' | 'playlists' | 'clusters'
  /**
   * Up to this many symbol classes get distinct node shapes
   * (circle/square/triangle/…), whichever icon mode provides them.
   */
  maxGenreClasses: number
  /** Preferred BPM trajectory for generated sets. */
  bpmProgression: BpmProgression
  /**
   * The Tracks table's columns: membership AND order (v8 issue 15). Fields
   * not listed are hidden; header drag reorders this list.
   */
  trackColumns: TrackSortField[]
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: null,
  colorScheme: 'blue',
  slotSpreadFactor: 1,
  jitterSeed: 0,
  edgeOpacity: 0.35,
  suggestLength: 15,
  suggestRandomness: 0.25,
  iconMode: 'families',
  maxGenreClasses: 4,
  bpmProgression: 'any',
  trackColumns: ['artist', 'title', 'key', 'bpm', 'genre', 'year', 'rating'],
}
