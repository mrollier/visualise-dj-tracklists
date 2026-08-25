import { get } from 'svelte/store'
import { DEFAULT_CRITERIA } from '../core/combos'
import { EMPTY_FILTERS } from '../core/filter'
import {
  buildReport,
  type ImportReport,
  type ManualEdge,
  type Playlist,
  type Track,
} from '../core/model'
import { parseProject, type Project } from '../core/persist'
import { freshFirstSet, type TrackSet } from '../core/sets'
import { DEFAULT_SETTINGS } from '../core/settings'
import { ALL_SAMPLE_PACKS, CLASSIC_PACK, SAMPLE_COLLECTION } from '../data/samples'
import {
  activeSetId,
  analysis,
  autosaveError,
  colorAxis,
  criteria,
  filters,
  lastImportReport,
  library,
  libraryName,
  manualEdges,
  mustInclude,
  pinnedFirst,
  pinnedLast,
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
    version: 10,
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
    analysis: get(analysis),
  }
}

export function applyProject(project: Project): void {
  libraryName.set(project.libraryName)
  library.set(project.tracks)
  // Unconditional, not `?? keep`: the tour snapshots the live project and
  // restores it here, so a sidecar loaded DURING the tour must not survive
  // "return to my work" any more than a library change would.
  analysis.set(project.analysis)
  manualEdges.set(project.manualEdges)
  criteria.set(project.criteria)
  // v18 #3/#8 review fix (B5): marks are session-only state describing
  // mustInclude/pins (wiped below by resetSuggestions()), so an active
  // marks flag can't survive this restore intact — a project loaded via
  // parseProject already carries both-off (migrateFilters' "always loads
  // off" rule), but applyProject has a second, unmigrated caller: the
  // guided tour's "return to my work" snapshots the LIVE project object via
  // currentProject() (no serialize/parse round-trip) before swapping in the
  // sample, then restores it here — if a header ★/🔗 toggle was on at that
  // moment, filters.set(project.filters) would restore it active over the
  // now-empty stars/combos resetSuggestions() is about to produce, filtering
  // the whole library out from under the user the moment they return.
  filters.set({
    ...project.filters,
    marks: { starredOnly: false, comboOnly: false, constellationOnly: false },
  })
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
 * then behaves exactly like an imported collection XML (design-v6 §D) —
 * except the demo starts with the Classic pack already toggled on (v14 WS3
 * D2), so the wheel isn't empty the moment someone loads the sample. A user's
 * own import still starts at an empty wheel (unchanged, recorded decision).
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
    selectedPlaylists: [CLASSIC_PACK.name],
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

/**
 * Whether the given state holds anything a user would mind losing: a track
 * in any set, a manual edge, or a session-only mark (★ must-include, or a
 * pinned opener/closer). Untouched sets over an empty or sample library
 * don't count — there's nothing there to grieve (v18 #1).
 */
export function hasUserWork(state: {
  sets: TrackSet[]
  manualEdges: ManualEdge[]
  mustInclude: string[]
  pinnedFirst: string | null
  pinnedLast: string | null
}): boolean {
  return (
    state.sets.some((set) => set.trackIds.length > 0) ||
    state.manualEdges.length > 0 ||
    state.mustInclude.length > 0 ||
    state.pinnedFirst !== null ||
    state.pinnedLast !== null
  )
}

/** Load-sample / tour guard: real-library warning (unchanged) OR user work over any library. */
export function sampleLoadNeedsConfirmation(): boolean {
  return (
    replaceNeedsConfirmation() ||
    hasUserWork({
      sets: get(sets),
      manualEdges: get(manualEdges),
      mustInclude: get(mustInclude),
      pinnedFirst: get(pinnedFirst),
      pinnedLast: get(pinnedLast),
    })
  )
}

/** Restore the autosaved project, if any. Returns whether something loaded. */
export function restoreAutosave(): boolean {
  let saved: string | null
  try {
    // The accessor itself throws where site data is blocked (Safari private
    // mode, a hardened profile), so this cannot be folded into the block
    // below — tour.ts:76 guards its own read the same way.
    saved = localStorage.getItem(STORAGE_KEY)
  } catch {
    return false
  }
  if (saved === null) return false
  try {
    applyProject(parseProject(saved))
    return true
  } catch {
    // Deliberately NOT removed. A save this build cannot read (a rolled-back
    // bundle meeting a newer schema) may still be readable by the next one;
    // deleting it here would make that unrecoverable.
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
        // COMPACT, unlike the .json download: `serializeProject` indents for
        // hand-editing, which costs ~1.2 MB on a 2080-track library and is
        // pure waste in a 5 MB localStorage budget an analysis sidecar can
        // otherwise push us past. `parseProject` does not care about
        // whitespace, so the saved document is identical in every way that
        // matters (v33).
        localStorage.setItem(STORAGE_KEY, JSON.stringify(currentProject()))
        autosaveError.set(null)
      } catch {
        // Storage full or unavailable. Autosave is still best-effort, but it
        // must not fail SILENTLY: before v33 a quota breach stopped the whole
        // project autosaving — sets, filters, criteria — with nothing on
        // screen to connect the loss to, and the analysis sidecar is what
        // makes a breach plausible.
        autosaveError.set('Autosave failed — this browser is out of storage. Save to a file.')
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
    analysis,
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
  manualEdges.set([]) // orphaned 🔗 edges otherwise survive the wipe
  analysis.set(null) // a full wipe clears analysis too, unlike replaceLibrary
  const first = freshFirstSet()
  sets.set([first])
  activeSetId.set(first.id)
  radialAxis.set('bpm')
  colorAxis.set('auto')
  selectedId.set(null)
  lastImportReport.set(null)
  resetSuggestions()
}
