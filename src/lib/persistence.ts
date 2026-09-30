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
import {
  diffLibraries,
  importDecision,
  remapWork,
  type LibraryDiff,
  type RemappedWork,
} from '../core/libraryUpdate'
import { fileStem } from '../core/exporters/filename'
import { serializeProject, type Project } from '../core/persist'
import { freshFirstSet, type TrackSet } from '../core/sets'
import { DEFAULT_SETTINGS } from '../core/settings'
import { ALL_SAMPLE_PACKS, CLASSIC_PACK, SAMPLE_COLLECTION } from '../data/samples'
import {
  activeSetId,
  analysis,
  colorAxis,
  criteria,
  filters,
  lastImportReport,
  library,
  libraryName,
  manualEdges,
  playlists,
  radialAxis,
  selectedId,
  sets,
  settings,
} from '../stores'
import { saveFile } from './saveFile'
import { resetUndo } from './undoStore'

export function currentProject(): Project {
  return {
    version: 11,
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

/** Save the whole project as a JSON file the user keeps (⌘S, Save project). */
export function saveProject(): Promise<void> {
  return saveFile(`${fileStem(get(libraryName)) || 'Zodiac Tracker'} project`, [
    {
      description: 'Zodiac Tracker project',
      mime: 'application/json',
      ext: '.json',
      blob: () => new Blob([serializeProject(currentProject())], { type: 'application/json' }),
    },
  ])
}

export function applyProject(project: Project): void {
  // Cleared first and set last, like replaceLibrary: the heavy derivations
  // run once against the final state, and the audio decks drop tracks that
  // vanish — so an id both libraries share can never keep the old file.
  library.set([])
  libraryName.set(project.libraryName)
  // Unconditional, not `?? keep`: the tour snapshots the live project and
  // restores it here, so a sidecar loaded DURING the tour must not survive
  // "return to my work" any more than a library change would.
  analysis.set(project.analysis)
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
  library.set(project.tracks)
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
  // Clear the library FIRST and set the new tracks LAST: every store write in
  // between propagates synchronously through the derived graph, and any pass
  // where a non-empty library meets not-yet-final filters runs the O(n²)
  // combo compute for nothing (the pre-v37 order did exactly that — the
  // 10-20s import freeze was mostly this waste, computed twice). Against an
  // empty library every intermediate recompute is trivial, and the single
  // final set() computes once, under the final filters.
  library.set([])
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
  library.set(tracks)
}

/** What importing a collection over the current one would do, before doing it. */
export interface ImportPlan {
  decision: ReturnType<typeof importDecision>
  diff: LibraryDiff
  remapped: RemappedWork
}

export function planLibraryImport(
  tracks: Track[],
  incomingPlaylists: readonly Playlist[],
): ImportPlan {
  const diff = diffLibraries(get(library), tracks)
  const remapped = remapWork(
    {
      sets: get(sets),
      manualEdges: get(manualEdges),
      selectedId: get(selectedId),
      playlistSelection: get(filters).playlists,
    },
    diff,
    incomingPlaylists,
  )
  const { slots, marks, manualEdges: edges } = remapped.lost
  return {
    decision: importDecision(!replaceNeedsConfirmation(), diff, slots + marks + edges),
    diff,
    remapped,
  }
}

/** The import report's account of an update, in the ⓘ's house style. */
function updateNotes({ diff, remapped }: ImportPlan): string[] {
  const gone = diff.gone.length - remapped.carried.length
  const notes = [
    `Updated in place: +${diff.added.length} new · −${gone} gone · ${diff.changed.length} changed key/BPM`,
  ]
  if (diff.matchedByLocation > 0) {
    notes.push(
      `Matched ${diff.matchedById} by Rekordbox ID, ${diff.matchedByLocation} by file or title`,
    )
  }
  const { slots, marks, manualEdges: edges } = remapped.lost
  if (slots + marks + edges > 0) {
    notes.push(
      `Removed with the tracks that are gone: ${slots} constellation slots, ${marks} ★/pins, ${edges} combos`,
    )
  }
  if (diff.changed.length > 0) {
    const titles = diff.changed.slice(0, 5).map((c) => c.title)
    notes.push(`Changed: ${titles.join(', ')}${diff.changed.length > 5 ? ', …' : ''}`)
  }
  return notes
}

/**
 * Update the loaded library in place from a re-imported collection: sets
 * (ids, names, marks), manual combos, the selection and the playlist choice
 * carry across through the plan's id map; criteria, settings and every other
 * filter stay as they are. Cleared first and set last, like replaceLibrary,
 * so the heavy derivations run once against the final state. Undo restarts:
 * a snapshot from before the update would point at the old ids.
 */
export function updateLibrary(
  incoming: { tracks: Track[]; name: string; playlists: Playlist[] },
  plan: ImportPlan,
  report: ImportReport,
): void {
  const { remapped } = plan
  library.set([])
  libraryName.set(incoming.name)
  manualEdges.set(remapped.manualEdges)
  sets.set(remapped.sets)
  playlists.set(incoming.playlists)
  filters.update((f) => ({ ...f, playlists: remapped.playlistSelection }))
  selectedId.set(remapped.selectedId)
  lastImportReport.set({ ...report, notes: [...(report.notes ?? []), ...updateNotes(plan)] })
  library.set([...incoming.tracks, ...remapped.carried])
  resetUndo()
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
 * or a mark (★ essential, ⏮/⏭ pin) in any set, or a manual edge. Untouched
 * sets over an empty or sample library don't count — nothing to grieve.
 */
export function hasUserWork(state: { sets: TrackSet[]; manualEdges: ManualEdge[] }): boolean {
  return (
    state.manualEdges.length > 0 ||
    state.sets.some(
      (set) =>
        set.trackIds.length > 0 ||
        set.mustInclude.length > 0 ||
        set.pinnedFirst !== null ||
        set.pinnedLast !== null,
    )
  )
}

/** Load-sample / tour guard: real-library warning OR user work over any library. */
export function sampleLoadNeedsConfirmation(): boolean {
  return (
    replaceNeedsConfirmation() || hasUserWork({ sets: get(sets), manualEdges: get(manualEdges) })
  )
}

/** Wipe the working state back to defaults (Reset clears the autosave too). */
export function resetEverything(): void {
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
}
