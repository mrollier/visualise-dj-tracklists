import { get } from 'svelte/store'
import { DEFAULT_CRITERIA } from '../core/combos'
import { EMPTY_FILTERS } from '../core/filter'
import { buildReport, type ImportReport, type Playlist, type Track } from '../core/model'
import { parseProject, serializeProject, type Project } from '../core/persist'
import { freshFirstSet } from '../core/sets'
import { DEFAULT_SETTINGS } from '../core/settings'
import { ALL_SAMPLE_PACKS, SAMPLE_COLLECTION } from '../data/samples'
import {
  activeSetId,
  colorAxis,
  criteria,
  filters,
  lastImportReport,
  library,
  libraryName,
  manualEdges,
  playlists,
  radialAxis,
  resetSuggestions,
  selectedId,
  sets,
  settings,
} from '../stores'

// ":v1" names the storage slot, not the project schema (parseProject
// migrates whatever schema version it finds in the slot).
const STORAGE_KEY = 'visualise-dj-tracklists:project:v1'

export function currentProject(): Project {
  return {
    version: 6,
    libraryName: get(libraryName),
    manualEdges: get(manualEdges),
    tracks: get(library),
    criteria: get(criteria),
    filters: get(filters),
    settings: get(settings),
    sets: get(sets),
    activeSetId: get(activeSetId),
    playlists: get(playlists),
    radialAxis: get(radialAxis),
    colorAxis: get(colorAxis),
  }
}

export function applyProject(project: Project): void {
  libraryName.set(project.libraryName)
  library.set(project.tracks)
  manualEdges.set(project.manualEdges)
  criteria.set(project.criteria)
  filters.set(project.filters)
  settings.set(project.settings)
  sets.set(project.sets)
  activeSetId.set(project.activeSetId)
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
  // A fresh library's ids share nothing with the old marks (v12 WS9).
  manualEdges.set([])
  // A fresh library starts over with a single First Set (issue 18).
  const first = freshFirstSet(set)
  sets.set([first])
  activeSetId.set(first.id)
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
  // The sample raises a report like any import, so the status ⓘ next to
  // "Sample collection" shows its counts (v11 issue 4).
  const report = buildReport(SAMPLE_COLLECTION.tracks, [])
  report.notes = [`${SAMPLE_COLLECTION.playlists.length} themed playlists`]
  replaceLibrary({
    tracks: SAMPLE_COLLECTION.tracks,
    name: SAMPLE_COLLECTION.name,
    playlists: SAMPLE_COLLECTION.playlists,
    report,
  })
}

// The classic pack's tracks predate the pack scheme and carry 'sample-' ids.
const SAMPLE_ID_PREFIXES = ['sample-', ...ALL_SAMPLE_PACKS.map((p) => `${p.id}-`)]

/** Sample libraries are disposable: replacing one never needs confirmation. */
export function isSampleLibrary(tracks: Track[]): boolean {
  return tracks.length > 0 && SAMPLE_ID_PREFIXES.some((p) => tracks[0].id.startsWith(p))
}

/**
 * Whether replacing the library would destroy user work (samples and an
 * empty library are disposable). The caller shows the in-app ConfirmDialog
 * when this is true (issue 6: no more native confirm()).
 */
export function replaceNeedsConfirmation(): boolean {
  const current = get(library)
  return current.length > 0 && !isSampleLibrary(current)
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
    sets, // every tracklist edit flows through here
    activeSetId,
    manualEdges,
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
  const first = freshFirstSet()
  sets.set([first])
  activeSetId.set(first.id)
  radialAxis.set('bpm')
  colorAxis.set('auto')
  selectedId.set(null)
  lastImportReport.set(null)
  resetSuggestions()
}
