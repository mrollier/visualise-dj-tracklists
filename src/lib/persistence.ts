import { get } from 'svelte/store'
import { DEFAULT_CRITERIA } from '../core/combos'
import { EMPTY_FILTERS } from '../core/filter'
import { parseProject, serializeProject, type Project } from '../core/persist'
import { DEFAULT_SETTINGS } from '../core/settings'
import {
  colorAxis,
  criteria,
  filters,
  library,
  libraryName,
  radialAxis,
  selectedId,
  settings,
  suggestionHistory,
  suggestionIndex,
  tracklist,
} from '../stores'

const STORAGE_KEY = 'visualise-dj-tracklists:project:v1'

export function currentProject(): Project {
  return {
    version: 2,
    libraryName: get(libraryName),
    tracks: get(library),
    criteria: get(criteria),
    filters: get(filters),
    settings: get(settings),
    tracklist: get(tracklist),
    radialAxis: get(radialAxis),
    colorAxis: get(colorAxis),
  }
}

export function applyProject(project: Project): void {
  libraryName.set(project.libraryName)
  library.set(project.tracks)
  criteria.set(project.criteria)
  filters.set(project.filters)
  settings.set(project.settings)
  tracklist.set(project.tracklist)
  radialAxis.set(project.radialAxis)
  colorAxis.set(project.colorAxis)
  selectedId.set(null)
}

/** Restore the autosaved project, if any. Returns whether something loaded. */
export function restoreAutosave(): boolean {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === null) return false
    applyProject(parseProject(saved))
    return true
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return false
  }
}

/** Persist every meaningful state change to localStorage, debounced. */
export function startAutosave(): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const save = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (get(library).length === 0) return // nothing worth saving yet
      try {
        localStorage.setItem(STORAGE_KEY, serializeProject(currentProject()))
      } catch {
        // Storage full or unavailable — autosave is best-effort.
      }
    }, 400)
  }
  for (const store of [
    library,
    libraryName,
    criteria,
    filters,
    settings,
    tracklist,
    radialAxis,
    colorAxis,
  ]) {
    store.subscribe(save)
  }
}

/** Wipe everything: stores back to defaults and the autosave cleared. */
export function resetEverything(): void {
  localStorage.removeItem(STORAGE_KEY)
  library.set([])
  libraryName.set('')
  criteria.set(structuredClone(DEFAULT_CRITERIA))
  filters.set(structuredClone(EMPTY_FILTERS))
  settings.set(structuredClone(DEFAULT_SETTINGS))
  tracklist.set([])
  radialAxis.set('bpm')
  colorAxis.set('auto')
  selectedId.set(null)
  suggestionHistory.set([])
  suggestionIndex.set(-1)
}
