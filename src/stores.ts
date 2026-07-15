import { derived, writable } from 'svelte/store'
import {
  computeEdges,
  DEFAULT_CRITERIA,
  makeGenreMatcher,
  type CriteriaConfig,
} from './core/combos'
import {
  applyFilters,
  applyPlaylistFilter,
  EMPTY_FILTERS,
  type LibraryFilters,
} from './core/filter'
import { computeGenreClasses } from './core/genreClasses'
import type { ImportReport, Playlist, Track } from './core/model'
import { DEFAULT_SETTINGS, type AppSettings } from './core/settings'

export type RadialAxis = 'bpm' | 'rating' | 'year'
export type ColorAxis = 'auto' | RadialAxis
export type ViewMode = 'wheel' | 'genres'

export const library = writable<Track[]>([])
/** Playlists imported with the library (Rekordbox XML); [] otherwise. */
export const playlists = writable<Playlist[]>([])
/** Central view: the Camelot wheel or the genre map. Session-only. */
export const viewMode = writable<ViewMode>('wheel')
/** Right aside: the set, or the advanced settings in its place. Session-only. */
export const rightPanel = writable<'set' | 'advanced'>('set')
export const libraryName = writable<string>('')
export const lastImportReport = writable<ImportReport | null>(null)
export const criteria = writable<CriteriaConfig>(structuredClone(DEFAULT_CRITERIA))
export const filters = writable<LibraryFilters>(structuredClone(EMPTY_FILTERS))
export const settings = writable<AppSettings>(structuredClone(DEFAULT_SETTINGS))
export const radialAxis = writable<RadialAxis>('bpm')
export const colorAxis = writable<ColorAxis>('auto')
export const selectedId = writable<string | null>(null)
export const tracklist = writable<string[]>([])

/**
 * Session-only history of generated set suggestions (not persisted): the
 * ◀ previous / new ▶ arrows walk through it. `suggestionIndex` points at the
 * currently shown suggestion, -1 when none has been generated yet.
 */
export const suggestionHistory = writable<string[][]>([])
export const suggestionIndex = writable(-1)

/**
 * Pinned opener/closer for generated sets (session-only): DJs often fix the
 * first and last track and regenerate the middle. Cleared when the pinned
 * track leaves the set or the library is replaced.
 */
export const pinnedFirst = writable<string | null>(null)
export const pinnedLast = writable<string | null>(null)

/**
 * Tracks the user marked "must include" for generated sets (session-only,
 * like the pins): a strong bias, not a guarantee — see design-v6 §C.
 */
export const mustInclude = writable<string[]>([])

/** Clear the suggestion history — call whenever the library is replaced. */
export function resetSuggestions(): void {
  suggestionHistory.set([])
  suggestionIndex.set(-1)
  pinnedFirst.set(null)
  pinnedLast.set(null)
  mustInclude.set([])
}

/** The filtered library: what the wheel, edges and suggestions operate on. */
export const visibleLibrary = derived(
  [library, filters, playlists],
  ([$library, $filters, $playlists]) => applyFilters($library, $filters, $playlists),
)

/**
 * The library scoped to the playlist selection only (ranges and genres are
 * ignored): the range-filter defaults and the radial axis fallback derive
 * from this, so they follow the playlists you are actually working in.
 */
export const playlistScopedLibrary = derived(
  [library, filters, playlists],
  ([$library, $filters, $playlists]) =>
    applyPlaylistFilter($library, $filters.playlists, $playlists),
)

/** Colour axis resolved: 'auto' = rating, or BPM when the radius shows rating. */
export const effectiveColorAxis = derived(
  [colorAxis, radialAxis],
  ([$colorAxis, $radialAxis]): RadialAxis =>
    $colorAxis !== 'auto' ? $colorAxis : $radialAxis === 'rating' ? 'bpm' : 'rating',
)

/** Distinct genres present in the (unfiltered) library, alphabetical. */
export const libraryGenres = derived(library, ($library) => {
  const seen = new Map<string, string>()
  for (const t of $library) {
    if (t.genre !== null && !seen.has(t.genre.toLowerCase()))
      seen.set(t.genre.toLowerCase(), t.genre)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
})

export const edges = derived([visibleLibrary, criteria], ([$visibleLibrary, $criteria]) =>
  computeEdges($visibleLibrary, $criteria),
)

/** Library-wide genre matcher, so pairwise UI (set transitions) agrees with the wheel's edges. */
export const genreMatcher = derived([visibleLibrary, criteria], ([$visibleLibrary, $criteria]) =>
  makeGenreMatcher(
    $visibleLibrary.map((t) => t.genre),
    $criteria,
  ),
)

/**
 * Genre classes (node shapes), clustered in the selected similarity space.
 * Derived from the FULL library, not the filtered view: filtering must never
 * re-cluster — a genre keeps its symbol while nodes come and go (design-v5 §A).
 */
export const genreClasses = derived(
  [library, criteria, settings],
  ([$library, $criteria, $settings]) =>
    computeGenreClasses(
      $library.map((t) => t.genre),
      $criteria.genre.method,
      $settings.maxGenreClasses,
    ),
)

export const trackById = derived(library, ($library) => new Map($library.map((t) => [t.id, t])))

/** Adjacency: for each track id, the ids it shares a combo edge with. */
export const neighbours = derived(edges, ($edges) => {
  const map = new Map<string, Set<string>>()
  for (const e of $edges) {
    if (!map.has(e.sourceId)) map.set(e.sourceId, new Set())
    if (!map.has(e.targetId)) map.set(e.targetId, new Set())
    map.get(e.sourceId)!.add(e.targetId)
    map.get(e.targetId)!.add(e.sourceId)
  }
  return map
})
