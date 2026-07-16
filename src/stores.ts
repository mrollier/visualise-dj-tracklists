import { derived, get, writable, type Writable } from 'svelte/store'
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
import { freshFirstSet, nextSetName, type TrackSet } from './core/sets'
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

/**
 * Multiple named sets (issue 18, persisted): always at least one; the active
 * one is what the wheel/panel edit. `tracklist` below keeps its historical
 * Writable<string[]> API but is backed by the active set, so the many
 * existing readers and writers stay unchanged.
 */
const initialSet = freshFirstSet()
export const sets = writable<TrackSet[]>([initialSet])
export const activeSetId = writable<string>(initialSet.id)

function activeSetOf($sets: TrackSet[], $activeId: string): TrackSet {
  return $sets.find((s) => s.id === $activeId) ?? $sets[0]
}

/** The full active set (name, generated flag, tracks). */
export const activeSet = derived([sets, activeSetId], ([$sets, $activeId]) =>
  activeSetOf($sets, $activeId),
)

function writeActiveTrackIds(fn: (ids: string[]) => string[], generated: boolean): void {
  sets.update(($sets) => {
    const current = activeSetOf($sets, get(activeSetId))
    return $sets.map((s) =>
      s.id === current.id ? { ...s, trackIds: fn(s.trackIds), generated } : s,
    )
  })
}

/**
 * The active set's track ids, as a plain Writable so every existing consumer
 * keeps working. Manual set/update marks the active set as hand-edited
 * (generated: false); the generator writes through setGeneratedTracklist.
 */
export const tracklist: Writable<string[]> = {
  subscribe: derived(activeSet, ($active) => $active.trackIds).subscribe,
  set: (ids) => writeActiveTrackIds(() => ids, false),
  update: (fn) => writeActiveTrackIds(fn, false),
}

/** Generator output: replaces the active set's tracks and flags it ✨. */
export function setGeneratedTracklist(ids: string[]): void {
  writeActiveTrackIds(() => ids, true)
}

/** Create and activate an empty set with the next free ordinal name. */
export function addSet(): void {
  const set: TrackSet = {
    ...freshFirstSet(),
    name: nextSetName(get(sets).map((s) => s.name)),
  }
  sets.update(($sets) => [...$sets, set])
  activeSetId.set(set.id)
}

export function renameSet(id: string, name: string): void {
  const trimmed = name.trim()
  if (trimmed === '') return
  sets.update(($sets) => $sets.map((s) => (s.id === id ? { ...s, name: trimmed } : s)))
}

/**
 * Delete a set; the last remaining set is cleared instead (there is always
 * one). Deleting the active set activates its predecessor (or successor).
 */
export function deleteSet(id: string): void {
  const $sets = get(sets)
  if ($sets.length <= 1) {
    tracklist.set([])
    return
  }
  const index = $sets.findIndex((s) => s.id === id)
  if (index === -1) return
  const remaining = $sets.toSpliced(index, 1)
  sets.set(remaining)
  if (get(activeSetId) === id) {
    activeSetId.set(remaining[Math.max(0, index - 1)].id)
  }
}

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

/**
 * Distinct genres present in the SELECTED PLAYLISTS, alphabetical (issue 14:
 * a whole-collection checklist drowns the playlists you actually work in).
 */
export const scopedGenres = derived(playlistScopedLibrary, ($scoped) => {
  const seen = new Map<string, string>()
  for (const t of $scoped) {
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
 * Derived from the playlist-scoped library (issue 14, superseding the
 * design-v5 §A whole-library rule): range/genre filtering still never
 * re-clusters — a genre keeps its symbol while nodes come and go — but
 * toggling playlists deliberately re-clusters to the new selection.
 */
export const genreClasses = derived(
  [playlistScopedLibrary, criteria, settings],
  ([$scoped, $criteria, $settings]) =>
    computeGenreClasses(
      $scoped.map((t) => t.genre),
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
