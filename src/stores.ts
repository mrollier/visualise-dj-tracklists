import { derived, writable } from 'svelte/store'
import { computeEdges, DEFAULT_CRITERIA, type CriteriaConfig } from './core/combos'
import { applyFilters, EMPTY_FILTERS, type LibraryFilters } from './core/filter'
import type { ImportReport, Track } from './core/model'
import { DEFAULT_SETTINGS, type AppSettings } from './core/settings'

export type RadialAxis = 'bpm' | 'rating' | 'year'
export type ColorAxis = 'auto' | RadialAxis

export const library = writable<Track[]>([])
export const libraryName = writable<string>('')
export const lastImportReport = writable<ImportReport | null>(null)
export const criteria = writable<CriteriaConfig>(structuredClone(DEFAULT_CRITERIA))
export const filters = writable<LibraryFilters>(structuredClone(EMPTY_FILTERS))
export const settings = writable<AppSettings>(structuredClone(DEFAULT_SETTINGS))
export const radialAxis = writable<RadialAxis>('bpm')
export const colorAxis = writable<ColorAxis>('auto')
export const selectedId = writable<string | null>(null)
export const tracklist = writable<string[]>([])

/** The filtered library: what the wheel, edges and suggestions operate on. */
export const visibleLibrary = derived([library, filters], ([$library, $filters]) =>
  applyFilters($library, $filters),
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
