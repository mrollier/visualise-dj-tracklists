/**
 * Display / behaviour settings, adjustable in the Advanced menu and persisted
 * with the project. Anything that changes *what connects to what* lives in
 * CriteriaConfig or LibraryFilters instead — settings only shape presentation
 * and generation defaults.
 */
export interface AppSettings {
  /** Node colour scheme (each ramp validated against the dark surface). */
  colorScheme: 'blue' | 'aqua' | 'violet'
  /** Angular fan-out of same-key tracks across their slot, in degrees. */
  slotSpreadDeg: number
  /** Base opacity of suggestion edges. */
  edgeOpacity: number
  /** Target number of tracks for the suggested-set generator. */
  suggestLength: number
  /** 0 = safest transitions, 1 = adventurous/dissonant sampling. */
  suggestRandomness: number
  /**
   * Up to this many clearly-different genre classes get distinct node shapes
   * (circle/square/triangle/…). Shapes only appear when the library's genres
   * actually separate in the selected similarity space.
   */
  maxGenreClasses: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  colorScheme: 'blue',
  slotSpreadDeg: 7.5,
  edgeOpacity: 0.35,
  suggestLength: 15,
  suggestRandomness: 0.25,
  maxGenreClasses: 4,
}
