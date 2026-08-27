import { derived, get, writable, type Readable, type Writable } from 'svelte/store'
import { mergeAnalysis, type AnalysisSidecar } from './core/analysis'
import {
  computeComboView,
  DEFAULT_CRITERIA,
  EASY_CRITERIA,
  focusEdges as computeFocusEdges,
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
import { genreFamilyClasses, playlistClasses } from './core/iconClasses'
import {
  comboIdSet,
  MARK_FILTERS,
  PANEL_FILTERS,
  starredIdSet,
  type MarksContext,
  type MarksFilter,
  type PanelFilterKey,
} from './core/marks'
import {
  applySourcePreference,
  type ImportReport,
  type ManualEdge,
  type Playlist,
  type Track,
} from './core/model'
import { canAddSet, freshFirstSet, nextSetName, uniqueSetName, type TrackSet } from './core/sets'
import { DEFAULT_SETTINGS, type AppSettings } from './core/settings'
import type { TrackSort } from './core/trackSort'
import { prefersReducedMotion } from './lib/motion'

export type RadialAxis = 'bpm' | 'rating' | 'year' | 'energy'
type ColorAxis = 'auto' | RadialAxis
type ViewMode = 'wheel' | 'genres' | 'tracks'

export const library = writable<Track[]>([])
/**
 * Audio-analysis results keyed by file path (v33 WS1). Deliberately NOT
 * cleared by `replaceLibrary`: track ids do not survive a re-import but file
 * paths do, and a multi-hour analysis batch is not disposable.
 */
export const analysis = writable<AnalysisSidecar | null>(null)
/**
 * Set when a localStorage write fails, cleared when one succeeds. Autosave is
 * best-effort, but before v33 it failed SILENTLY — a quota breach stopped the
 * whole project saving, with nothing on screen to connect the loss to. An
 * analysis sidecar is what makes a breach plausible on a real library.
 */
export const autosaveError = writable<string | null>(null)
/** Playlists imported with the library (Rekordbox XML); [] otherwise. */
export const playlists = writable<Playlist[]>([])
/** Central view: the Camelot wheel or the genre map. Session-only. */
export const viewMode = writable<ViewMode>('wheel')
/** Right aside: the set, or the advanced settings in its place. Session-only. */
export const rightPanel = writable<'set' | 'advanced'>('set')
/** The Tracks table's sort — session-only, but it survives view switches (v8 issue 15). */
export const trackSort = writable<TrackSort>({ field: 'artist', dir: 'asc' })
export const libraryName = writable<string>('')
export const lastImportReport = writable<ImportReport | null>(null)
export const criteria = writable<CriteriaConfig>(structuredClone(DEFAULT_CRITERIA))
export const filters = writable<LibraryFilters>(structuredClone(EMPTY_FILTERS))
export const settings = writable<AppSettings>(structuredClone(DEFAULT_SETTINGS))
export const radialAxis = writable<RadialAxis>('bpm')
export const colorAxis = writable<ColorAxis>('auto')
export const selectedId = writable<string | null>(null)
/**
 * The last track the user clicked ON DIRECTLY — a wheel star or a Tracks-view
 * row — as opposed to the many things that move `selectedId` without anyone
 * clicking a track: the wheel hub's suggest/retry/reset picks, undo and redo
 * restoring a captured selection, background clicks, Escape, a project load.
 *
 * The audio preview listens to THIS, not to `selectedId` (v29 #10). Deck B is
 * "the track you clicked", which is a thing the user did; it is not "the
 * selection", which is a thing the app moves around. That is also what retires
 * the v28.1 deselection latch: a click event can never carry null, so there is
 * nothing left to latch against.
 *
 * Never persisted, and deliberately not cleared alongside `selectedId` — a
 * deck goes on playing until another track is clicked or the library changes.
 */
export const clickedTrackId = writable<string | null>(null)
/**
 * Track hovered in the set list (v9 issue 20): mirrored as a subtle halo on
 * the wheel node and a tint on the Tracks-view row, so the eye can find the
 * same track across views. Never persisted, cleared on mouse-leave.
 */
export const hoveredId = writable<string | null>(null)

/**
 * Walk-draw reveal trigger (v12 WS1, session-only): ✨/⚡ bumps the tick and
 * the wheel + set list replay their staggered reveal; `seen` catches up when
 * the reveal window closes so re-mounting a view (or undoing a suggestion)
 * never replays it.
 */
export const walkRevealTick = writable(0)
export const walkRevealSeen = writable(0)
/** S4: which node index range the next reveal should ANIMATE (null = full,
 * fresh ✨). ⚡ continue-in-place sets this so only the forced tail draws in,
 * leaving the already-drawn prefix/suffix static. */
export const walkRevealRange = writable<{ from: number; to: number } | null>(null)
/** The `s` hotkey (v12 WS14) asks whichever set panel is mounted to run ✨. */
export const suggestHotkeyTick = writable(0)
/** Guided-tour position (v12 WS12): null = closed; session-only. */
export const tourStep = writable<number | null>(null)
/** Keeps the window open past the last stagger for the trailing animations —
 * the final row fade (240ms), the last node pulse (320ms) and the completion
 * shimmer (700ms after totalMs) — so none of them get cut mid-flight. */
const WALK_REVEAL_TAIL_MS = 800
export function bumpWalkReveal(totalMs: number): void {
  const tick = get(walkRevealTick) + 1
  walkRevealTick.set(tick)
  // Under reduced motion the walk-draw, the node pulses and the row cascade
  // are all switched off in CSS, so there is no reveal to wait out. Close the
  // window in the same breath (v31 #2): callers that gate on "still drawing"
  // — the wheel hub, the ⚡ offer — must not be held for seconds by an
  // animation nobody is being shown.
  if (prefersReducedMotion()) {
    walkRevealSeen.set(tick)
    return
  }
  setTimeout(
    () => walkRevealSeen.update((seen) => Math.max(seen, tick)),
    totalMs + WALK_REVEAL_TAIL_MS,
  )
}

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

/**
 * Append a track to the active set — shared by the wheel's double-click and
 * the Tracks table (issue 7). The same track may appear twice in a set, just
 * not back-to-back.
 */
export function appendToSet(id: string): void {
  tracklist.update((ids) => (ids[ids.length - 1] === id ? ids : [...ids, id]))
}

/**
 * Add a track to the active set (S5): if the anchor track is already in the
 * set, splice the new one right after its FIRST occurrence; otherwise append.
 * The anchor defaults to the live selection, but the wheel passes it
 * explicitly — a double-click's two preceding `click` events have already
 * moved and then cleared `selectedId` by the time `ondblclick` runs (v17 #5).
 * `get()` reads are correct here — the callers are event handlers, not
 * reactive contexts. Skips an edit that would place the new track back-to-back
 * with an identical one (mirrors appendToSet's guard).
 */
export function addTrackToSet(newId: string, anchorId: string | null = get(selectedId)): void {
  const ids = get(tracklist)
  const at = anchorId === null ? -1 : ids.indexOf(anchorId)
  if (at === -1) {
    appendToSet(newId)
    return
  }
  if (ids[at] === newId || ids[at + 1] === newId) return // no back-to-back dup
  tracklist.update((cur) => cur.toSpliced(at + 1, 0, newId))
}

/**
 * Create and activate an empty set with the next free ordinal name. Refuses
 * silently at the cap — the ＋ and ✨ buttons disable themselves first.
 */
export function addSet(): void {
  if (!canAddSet(get(sets))) return
  const set: TrackSet = {
    ...freshFirstSet(),
    name: nextSetName(get(sets).map((s) => s.name)),
  }
  sets.update(($sets) => [...$sets, set])
  activeSetId.set(set.id)
}

/**
 * Rename a set; a name another set already holds gains a " (2)" suffix
 * (v9 issue 18) — names key nothing internally, but an ambiguous dropdown
 * helps no one.
 */
export function renameSet(id: string, name: string): void {
  const trimmed = name.trim()
  if (trimmed === '') return
  const taken = get(sets)
    .filter((s) => s.id !== id)
    .map((s) => s.name)
  const unique = uniqueSetName(trimmed, taken)
  sets.update(($sets) => $sets.map((s) => (s.id === id ? { ...s, name: unique } : s)))
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
 * Pinned opener/closer for generated sets (session-only): DJs often fix the
 * first and last track and regenerate the middle. Cleared when the pinned
 * track leaves the set or the library is replaced.
 */
export const pinnedFirst = writable<string | null>(null)
export const pinnedLast = writable<string | null>(null)

/**
 * Tracks the user marked "must include" for generated sets (session-only,
 * like the pins): a hard guarantee since v14 S1 — the suggester reserves
 * slots and forces edges if needed so every marked track lands in the walk.
 */
export const mustInclude = writable<string[]>([])

/** Clear the pins and marks — call whenever the library is replaced. */
export function resetSuggestions(): void {
  pinnedFirst.set(null)
  pinnedLast.set(null)
  mustInclude.set([])
}

/**
 * Manual edges (v12 WS9): user-marked "these mix well" pairs — planning
 * annotations, persisted with the project, never a play log. Toggled from the
 * selected-track card's link mode; pruned when a track leaves the library.
 * Declared up here (with the other engine inputs) so the effective layer and
 * the derivations below can consume it without a TDZ (v14 WS6).
 */
export const manualEdges = writable<ManualEdge[]>([])

/**
 * v14 E1: easy mode COMPUTES WITH defaults — it never mutates the stored
 * advanced state (which keeps feeding persist + undo). Playlist selection and
 * the created sets stay SHARED; criteria/filters/settings force to defaults and
 * manual edges go inactive. These are NEW DERIVED STORES swapped into the
 * engine-consuming derivations and the component call sites — the writables
 * themselves are left untouched, so flipping back to All controls returns every
 * stored value exactly as it was. structuredClone keeps the DEFAULT_* objects
 * from being aliased and accidentally mutated by a consumer.
 */
const easyMode = derived(settings, ($s) => $s.uiMode === 'easy')
export const effectiveCriteria = derived([criteria, easyMode], ([$c, $e]) =>
  $e ? structuredClone(EASY_CRITERIA) : $c,
)
export const effectiveFilters = derived([filters, easyMode], ([$f, $e]) =>
  $e ? { ...structuredClone(EMPTY_FILTERS), playlists: $f.playlists } : $f,
)
export const effectiveSettings = derived([settings, easyMode], ([$s, $e]) =>
  $e
    ? {
        ...structuredClone(DEFAULT_SETTINGS),
        theme: $s.theme,
        uiMode: $s.uiMode,
        advancedOpen: $s.advancedOpen,
        // Which panels are collapsed is chrome, not computation (v30): easy
        // mode must not quietly re-open one.
        showLeftPanel: $s.showLeftPanel,
        showRightPanel: $s.showRightPanel,
      }
    : $s,
)
export const effectiveManualEdges = derived([manualEdges, easyMode], ([$m, $e]) => ($e ? [] : $m))

/**
 * Wrap a store so subscribers are only notified when the value actually
 * changes per `equal` (v18 #3/#8), not merely re-derived to a new reference.
 * Svelte's own dedup (`derived`'s internal `safe_not_equal`) treats any
 * object/array as "always changed" — it can't cheaply tell whether one was
 * mutated in place — so an object-valued derived would otherwise re-emit,
 * and cascade into anything downstream, on every upstream tick even when
 * nothing the object represents actually changed. `marksContext` below is
 * exactly that case.
 */
function distinct<T>(store: Readable<T>, equal: (a: T, b: T) => boolean): Readable<T> {
  let last: T
  let hasLast = false
  return derived(store, ($value, set) => {
    if (!hasLast || !equal(last, $value)) {
      last = $value
      hasLast = true
      set($value)
    }
  })
}

function marksContextEqual(a: MarksContext | null, b: MarksContext | null): boolean {
  if (a === null || b === null) return a === b
  const setEqual = (x: ReadonlySet<string>, y: ReadonlySet<string>): boolean =>
    x.size === y.size && [...x].every((id) => y.has(id))
  return (
    setEqual(a.starredIds, b.starredIds) &&
    setEqual(a.comboIds, b.comboIds) &&
    setEqual(a.constellationIds, b.constellationIds)
  )
}

/**
 * The marks quick-filters' live context (v18 #3/#8, widened v25): `null`
 * while `starredOnly`/`comboOnly`/`constellationOnly` are all off, so
 * `visibleLibrary` stays inert to mustInclude/pin/manualEdges/tracklist
 * churn — the perf gate, since `visibleLibrary` feeds `computeComboView`,
 * which is O(n²), and would otherwise recompute on every star click (or
 * constellation edit) even with the filters off. Wrapped in `distinct` so
 * an on-flag recompute that lands on the same id SET (not just a new
 * object) doesn't cascade either. Reads `effectiveFilters` (not raw
 * `filters`) so easy mode's forced-off marks (stores.ts's
 * `effectiveFilters`) also gate this, not just the persisted layer.
 *
 * On a null↔non-null boundary transition (first flag on or last flag off),
 * `visibleLibrary` recomputes twice — once with the new flags against the
 * stale context, once with the new context — because it subscribes to
 * `effectiveFilters` before `marksContext` exists in the graph, so Svelte's
 * pending-bit diamond guard can't cover that ordering; the intermediate is
 * content-identical (flags-on with a missing context is inert by design), so
 * the cost is one extra O(n²) pass on those boundary clicks only.
 */
const marksContext: Readable<MarksContext | null> = distinct(
  derived(
    [effectiveFilters, mustInclude, pinnedFirst, pinnedLast, manualEdges, tracklist],
    ([
      $filters,
      $mustInclude,
      $pinnedFirst,
      $pinnedLast,
      $manualEdges,
      $tracklist,
    ]): MarksContext | null => {
      const { starredOnly, comboOnly, constellationOnly } = $filters.marks
      if (!starredOnly && !comboOnly && !constellationOnly) return null
      return {
        starredIds: starredIdSet($mustInclude, $pinnedFirst, $pinnedLast),
        comboIds: comboIdSet($manualEdges),
        constellationIds: new Set($tracklist),
      }
    },
  ),
  marksContextEqual,
)

/**
 * Turn one marks quick-filter on/off — the ONE mutator every write site
 * routes through (v18 #3/#8 review fix, B1): TracksView's header ★/🔗,
 * FiltersSection's all/only switches, and AdvancedMenu's hide-clears branch
 * and "Reset settings" button all call this instead of poking
 * `filters.marks` directly.
 *
 * Early-returns when `value` already matches — without it, a no-op click
 * (re-clicking the already-active "only" button, hiding an already-off row,
 * resetting an already-off flag) still writes `filters`, which cascades
 * into `marksContext`/`visibleLibrary` — the O(n²) combo recompute Task 6's
 * `distinct` wrapper guards against real churn, not this kind of no-op.
 *
 * Turning a flag ON also force-adds its row to `settings.visibleFilters` if
 * missing: the same "an active filter is never invisible" invariant
 * `persist.ts`'s force-visible loop keeps for property filters. A marks
 * flag activated from the Tracks-view header needs the identical escape
 * hatch, since the panel row is the only place to turn it off again once
 * the header toggle itself is disabled (nothing left to filter) or hidden
 * (easy mode, in-set-only mode).
 */
export function setMarkFilter(flag: keyof MarksFilter, value: boolean): void {
  if (get(filters).marks[flag] === value) return
  filters.update((f) => ({ ...f, marks: { ...f.marks, [flag]: value } }))
  if (!value) return
  const meta = MARK_FILTERS.find((m) => m.flag === flag)
  if (meta === undefined) return
  settings.update((s) =>
    s.visibleFilters.includes(meta.key)
      ? s
      : { ...s, visibleFilters: [...s.visibleFilters, meta.key] },
  )
}

/** Flip one marks quick-filter — the Tracks-view header ★/🔗 onclick. */
export function toggleMarkFilter(flag: keyof MarksFilter): void {
  setMarkFilter(flag, !get(filters).marks[flag])
}

/** Neutralise the filter a pseudo row owns, whatever backs it (v23): a
 *  hidden control must never keep acting — the same invariant
 *  `toggleFilterVisible` already keeps for property filters. */
export function clearPanelFilter(key: PanelFilterKey): void {
  const meta = PANEL_FILTERS.find((m) => m.key === key)
  if (meta === undefined) return
  if (meta.flag !== undefined) {
    setMarkFilter(meta.flag, false)
    return
  }
  const { minor, major } = get(filters).keyRings
  if (minor && major) return // already neutral — keep the no-op guard
  filters.update((f) => ({ ...f, keyRings: { minor: true, major: true } }))
}

/**
 * The library with analysed values filling the nulls Rekordbox left (v33 WS1).
 *
 * Everything that DISPLAYS or REASONS about track metadata reads this; raw
 * `library` stays the Rekordbox truth that feeds persistence, the importers
 * and the CSV exporter. Same shape as the easy-mode `effective*` layer: the
 * raw writable is never touched, so undo and autosave are unaffected.
 *
 * `mergeAnalysis` returns the input array BY REFERENCE when nothing is filled,
 * so with no sidecar loaded this is identity and every downstream memo behaves
 * exactly as it did before the feature existed.
 */
/**
 * The v36 source preference, projected through `distinct` so unrelated
 * settings churn (an edge-opacity slider drag) never re-emits into the
 * O(n²) combo view downstream. Reads the EFFECTIVE layer: easy mode runs
 * on Rekordbox truth like every other computed default.
 */
const sourcePrefs = distinct(
  derived(effectiveSettings, ($s) => ({ keySource: $s.keySource, bpmSource: $s.bpmSource })),
  (a, b) => a.keySource === b.keySource && a.bpmSource === b.bpmSource,
)
/**
 * Comment-sourced key/BPM substitution (v36), BEFORE the sidecar merge:
 * the fallback chain is comment token → Rekordbox value → analysis sidecar,
 * and a comment-sourced key is non-null so the sidecar never fills-and-badges
 * it. Identity when both prefs are 'rekordbox'.
 */
const sourced = derived([library, sourcePrefs], ([$library, $prefs]) =>
  applySourcePreference($library, $prefs),
)
const merged = derived([sourced, analysis], ([$sourced, $analysis]) =>
  mergeAnalysis($sourced, $analysis),
)
export const augmentedLibrary = derived(merged, ($merged) => $merged.tracks)
/** Which fields on which track came from analysis — drives the provenance badges. */
export const analysedFieldsById = derived(merged, ($merged) => $merged.analysedFields)

/**
 * Id → track for the surfaces that DISPLAY metadata (v33).
 *
 * Deliberately separate from `trackById`, which stays raw: that one resolves
 * the CSV export, and the app also IMPORTS CSV — so an augmented `trackById`
 * would give "export CSV, re-import it" the power to launder analysed values
 * into the library as Rekordbox-looking truth, permanently and in two clicks.
 */
export const augmentedTrackById = derived(
  augmentedLibrary,
  ($augmentedLibrary) => new Map($augmentedLibrary.map((t) => [t.id, t])),
)

/** The filtered library: what the wheel, edges and suggestions operate on. */
export const visibleLibrary = derived(
  [augmentedLibrary, effectiveFilters, playlists, marksContext],
  ([$augmentedLibrary, $effectiveFilters, $playlists, $marks]) =>
    applyFilters($augmentedLibrary, $effectiveFilters, $playlists, $marks ?? undefined),
)

/**
 * The library scoped to the playlist selection only (ranges and genres are
 * ignored): the range-filter defaults and the radial axis fallback derive
 * from this, so they follow the playlists you are actually working in.
 */
export const playlistScopedLibrary = derived(
  [augmentedLibrary, filters, playlists],
  ([$augmentedLibrary, $filters, $playlists]) =>
    applyPlaylistFilter($augmentedLibrary, $filters.playlists, $playlists),
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

/**
 * The combo graph, possibly symbolic: at threshold 0 every pair is a combo
 * and the edge list stays empty (v11 issue 2a) — consumers read `complete`
 * and `pairCount` instead of materializing n²/2 edges.
 */
const comboView = derived(
  [visibleLibrary, effectiveCriteria],
  ([$visibleLibrary, $effectiveCriteria]) => computeComboView($visibleLibrary, $effectiveCriteria),
)

export const edges = derived(comboView, ($comboView) => $comboView.edges)
export const comboComplete = derived(comboView, ($comboView) => $comboView.complete)
export const comboPairCount = derived(comboView, ($comboView) => $comboView.pairCount)

/**
 * The combo edges the wheel actually draws (v9 issue 8): the star around the
 * selected track, plus the cluster's interconnections when the setting asks.
 * No selection = no edges; the full `edges` set above keeps feeding
 * suggestions, retry and adjacency. On a complete graph (threshold 0) the
 * star is synthesized around the selection — the cluster option is ignored
 * there, since "the cluster" would be every pair on the wheel.
 */
export const focusEdges = derived(
  [edges, selectedId, effectiveSettings, comboComplete, visibleLibrary],
  ([$edges, $selectedId, $effectiveSettings, $comboComplete, $visibleLibrary]) => {
    if ($comboComplete) {
      if ($selectedId === null) return []
      return $visibleLibrary
        .filter((t) => t.id !== $selectedId)
        .map((t) => ({ sourceId: $selectedId, targetId: t.id, matched: [] }))
    }
    return computeFocusEdges($edges, $selectedId, $effectiveSettings.focusClusterEdges)
  },
)

/** Library-wide genre matcher, so pairwise UI (set transitions) agrees with the wheel's edges. */
export const genreMatcher = derived(
  [visibleLibrary, effectiveCriteria],
  ([$visibleLibrary, $effectiveCriteria]) =>
    makeGenreMatcher(
      $visibleLibrary.map((t) => t.genre),
      $effectiveCriteria,
    ),
)

/**
 * Node-shape classes per the icon mode (v8 issues 4+5): genre families from
 * the curated tree (default), the selected playlists (first wins, panel
 * order), or similarity clusters — clusters are pinned to the HYBRID space,
 * so changing the combo criterion's method never reshuffles icons (issue 4).
 * Still scoped to the selected playlists (v7 issue 14): range/genre
 * filtering never re-classes; playlist toggles deliberately do.
 */
export const iconClasses = derived(
  [playlistScopedLibrary, playlists, effectiveFilters, effectiveSettings],
  ([$scoped, $playlists, $effectiveFilters, $effectiveSettings]) => {
    const max = $effectiveSettings.maxGenreClasses
    if ($effectiveSettings.iconMode === 'playlists') {
      const selectedNames = $effectiveFilters.playlists
      const selected =
        selectedNames === null
          ? $playlists
          : $playlists.filter((p) => selectedNames.includes(p.name))
      return playlistClasses($scoped, selected, max)
    }
    const genres = $scoped.map((t) => t.genre)
    if ($effectiveSettings.iconMode === 'clusters') {
      const clustered = computeGenreClasses(genres, 'hybrid', max)
      return clustered === null ? null : { ...clustered, keyedBy: 'genre' as const }
    }
    return genreFamilyClasses(genres, max)
  },
)

/**
 * Id → track, RAW. Membership checks and the CSV/M3U/portrait exports resolve
 * through this, and a save or an export must carry Rekordbox truth — see
 * `augmentedTrackById` for the display side, and why the two are separate.
 */
export const trackById = derived(library, ($library) => new Map($library.map((t) => [t.id, t])))

export function toggleManualEdge(a: string, b: string): void {
  if (a === b) return
  manualEdges.update(($edges) => {
    const existing = $edges.findIndex((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))
    if (existing !== -1) return $edges.toSpliced(existing, 1)
    return [...$edges, { a, b }]
  })
}

/**
 * A click in link mode (v14 WS10, shared by the wheel and the tracks table): an
 * armed 🔗 with a different source selected turns the click into a combo
 * mark/unmark, keeping the selection on the source so marks chain; otherwise it
 * falls through to the plain select/deselect toggle. `get()` reads are correct
 * here — this runs in an event handler, not a reactive context.
 */
export function selectOrLink(id: string): void {
  if (get(linkArmed) && get(selectedId) !== null) {
    if (id !== get(selectedId)) toggleManualEdge(get(selectedId)!, id)
    return
  }
  // Announced before the toggle, and announced even when the toggle DESELECTS:
  // clicking a track is still a click on that track, and the audio deck it
  // feeds (v29 #10) should keep playing it rather than empty itself.
  clickedTrackId.set(id)
  selectedId.update((current) => (current === id ? null : id))
}

/** Link mode: the selected track is armed; the next wheel click marks/unmarks. */
export const linkArmed = writable(false)

/** Adjacency: for each track id, the ids it shares a combo edge with —
 * manual pairs included (v12 WS9), so the hub, retry ring and focus star all
 * treat a marked combo as a road. */
export const neighbours = derived(
  [edges, effectiveManualEdges],
  ([$edges, $effectiveManualEdges]) => {
    const map = new Map<string, Set<string>>()
    const connect = (x: string, y: string) => {
      if (!map.has(x)) map.set(x, new Set())
      if (!map.has(y)) map.set(y, new Set())
      map.get(x)!.add(y)
      map.get(y)!.add(x)
    }
    for (const e of $edges) connect(e.sourceId, e.targetId)
    for (const e of $effectiveManualEdges) connect(e.a, e.b)
    return map
  },
)
