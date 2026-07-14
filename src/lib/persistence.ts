import { get } from 'svelte/store'
import { parseProject, serializeProject, type Project } from '../core/persist'
import { criteria, library, libraryName, radialAxis, selectedId, tracklist } from '../stores'

const STORAGE_KEY = 'visualise-dj-tracklists:project:v1'

export function currentProject(): Project {
  return {
    version: 1,
    libraryName: get(libraryName),
    tracks: get(library),
    criteria: get(criteria),
    tracklist: get(tracklist),
    radialAxis: get(radialAxis),
  }
}

export function applyProject(project: Project): void {
  libraryName.set(project.libraryName)
  library.set(project.tracks)
  criteria.set(project.criteria)
  tracklist.set(project.tracklist)
  radialAxis.set(project.radialAxis)
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
  for (const store of [library, libraryName, criteria, tracklist, radialAxis]) {
    store.subscribe(save)
  }
}
