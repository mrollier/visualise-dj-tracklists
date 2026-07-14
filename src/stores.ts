import { derived, writable } from 'svelte/store'
import { computeEdges, DEFAULT_CRITERIA, type CriteriaConfig } from './core/combos'
import type { ImportReport, Track } from './core/model'

export type RadialAxis = 'bpm' | 'rating' | 'year'

export const library = writable<Track[]>([])
export const libraryName = writable<string>('')
export const lastImportReport = writable<ImportReport | null>(null)
export const criteria = writable<CriteriaConfig>(structuredClone(DEFAULT_CRITERIA))
export const radialAxis = writable<RadialAxis>('bpm')
export const selectedId = writable<string | null>(null)
export const tracklist = writable<string[]>([])

export const edges = derived([library, criteria], ([$library, $criteria]) =>
  computeEdges($library, $criteria),
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
