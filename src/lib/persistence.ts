import { get } from 'svelte/store'
import { DEFAULT_CRITERIA } from '../core/combos'
import { EMPTY_FILTERS } from '../core/filter'
import type { ImportReport, Playlist, Track } from '../core/model'
import { parseProject, serializeProject, type Project } from '../core/persist'
import { DEFAULT_SETTINGS } from '../core/settings'
import { ALL_SAMPLE_PACKS, SAMPLE_COLLECTION } from '../data/samples'
import {
  colorAxis,
  criteria,
  filters,
  lastImportReport,
  library,
  libraryName,
  playlists,
  radialAxis,
  resetSuggestions,
  selectedId,
  settings,
  tracklist,
} from '../stores'

// ":v1" names the storage slot, not the project schema (parseProject
// migrates whatever schema version it finds in the slot).
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
    playlists: get(playlists),
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
  playlists.set(project.playlists)
  radialAxis.set(project.radialAxis)
  colorAxis.set(project.colorAxis)
  selectedId.set(null)
  lastImportReport.set(null)
  resetSuggestions()
}

/**
 * Replace the loaded library wholesale — the single path every import and
 * sample load goes through, so stale filters, selection, suggestion state and
 * the import report can never leak from the previous library.
 */
export function replaceLibrary(replacement: {
  tracks: Track[]
  name: string
  /** The set (tracklist) that comes with the import; empty otherwise. */
  set?: string[]
  playlists?: Playlist[]
  /**
   * Playlists to start toggled ON (a single-playlist TXT import shows its
   * wheel immediately — design-v6 §E). Default: none selected.
   */
  selectedPlaylists?: string[]
  report?: ImportReport | null
}): void {
  const {
    tracks,
    name,
    set = [],
    playlists: imported = [],
    selectedPlaylists = [],
    report = null,
  } = replacement
  library.set(tracks)
  libraryName.set(name)
  tracklist.set(set)
  playlists.set(imported)
  // A collection carrying playlists starts with only `selectedPlaylists`
  // toggled on — by default none, i.e. an empty wheel until the user picks
  // (design-v5 §D); without playlists the filter is inactive.
  filters.set({
    ...structuredClone(EMPTY_FILTERS),
    playlists: imported.length > 0 ? selectedPlaylists : null,
  })
  lastImportReport.set(report)
  selectedId.set(null)
  resetSuggestions()
}

/**
 * Load the sample collection: every pack as a playlist in one library, which
 * then behaves exactly like an imported collection XML (design-v6 §D).
 */
export function loadSampleCollection(): void {
  replaceLibrary({
    tracks: SAMPLE_COLLECTION.tracks,
    name: SAMPLE_COLLECTION.name,
    playlists: SAMPLE_COLLECTION.playlists,
  })
}

// The classic pack's tracks predate the pack scheme and carry 'sample-' ids.
const SAMPLE_ID_PREFIXES = ['sample-', ...ALL_SAMPLE_PACKS.map((p) => `${p.id}-`)]

/** Sample libraries are disposable: replacing one never needs confirmation. */
export function isSampleLibrary(tracks: Track[]): boolean {
  return tracks.length > 0 && SAMPLE_ID_PREFIXES.some((p) => tracks[0].id.startsWith(p))
}

/** Ask before a sample pack replaces user work (samples replace silently). */
export function confirmReplaceLibrary(packName: string): boolean {
  const current = get(library)
  if (current.length === 0 || isSampleLibrary(current)) return true
  return confirm(`Replace the current library and set with "${packName}"?`)
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
    playlists,
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
  playlists.set([])
  criteria.set(structuredClone(DEFAULT_CRITERIA))
  filters.set(structuredClone(EMPTY_FILTERS))
  settings.set(structuredClone(DEFAULT_SETTINGS))
  tracklist.set([])
  radialAxis.set('bpm')
  colorAxis.set('auto')
  selectedId.set(null)
  lastImportReport.set(null)
  resetSuggestions()
}
