import { derived, get, writable, type Readable, type Writable } from 'svelte/store'
import { mergeAnalysis, mergeSidecars, type AnalysisSidecar } from './core/analysis'
import {
  buildComboGraph,
  countComboPairs,
  DEFAULT_CRITERIA,
  EASY_CRITERIA,
  focusEdgesFor,
  makeGenreMatcher,
  type CriteriaConfig,
} from './core/combos'
import {
  applyFilters,
  applyPlaylistFilter,
  EMPTY_FILTERS,
  type LibraryFilters,
} from './core/filter'
import { setGenreBridge } from './core/genre'
import { genreFamilyClasses } from './core/iconClasses'
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
import { chromeOf, DEFAULT_SETTINGS, type AppSettings } from './core/settings'
import type { TrackSort } from './core/trackSort'
import { SAMPLE_ANALYSIS } from './data/samples'
import { prefersReducedMotion } from './lib/motion'

export type RadialAxis = 'bpm' | 'rating' | 'year' | 'energy'
type ColorAxis = 'auto' | RadialAxis
type ViewMode = 'wheel' | 'genres' | 'tracks'

export const library = writable<Track[]>([])
/**
 * Audio-analysis results keyed by file path. Deliberately NOT cleared by
 * `replaceLibrary`: track ids do not survive a re-import but file paths do,
 * and a multi-hour analysis batch is not disposable.
 */
export const analysis = writable<AnalysisSidecar | null>(null)
/**
 * Set when a localStorage write fails, cleared when one succeeds. Autosave is
 * best-effort, but a failed write must not fail SILENTLY — without this, a
 * quota breach stops the whole project saving, with nothing on screen to
 * connect the loss to. An analysis sidecar is what makes a breach plausible
 * on a real library.
 */
export const autosaveError = writable<string | null>(null)
/**
 * Label of the import phase in flight ('Parsing foo.xml…'), null when idle.
 * Every phase is indeterminate, so the label IS the whole state — the header
 * renders it next to an indeterminate ProgressBar.
 */
export const importStatus = writable<string | null>(null)
/** Playlists imported with the library (Rekordbox XML); [] otherwise. */
export const playlists = writable<Playlist[]>([])
/** Central view: the Camelot wheel or the genre map. Session-only. */
export const viewMode = writable<ViewMode>('wheel')
/** Right aside: the set, or the advanced settings in its place. Session-only. */
export const rightPanel = writable<'set' | 'advanced'>('set')
/** The Tracks table's sort — session-only, but it survives view switches. */
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
 * The audio preview listens to THIS, not to `selectedId`. Deck B is
 * "the track you clicked", which is a thing the user did; it is not "the
 * selection", which is a thing the app moves around. A click event can never
 * carry null, so there is nothing here to latch against on deselect.
 *
 * Never persisted, and deliberately not cleared alongside `selectedId` — a
 * deck goes on playing until another track is clicked or the library changes.
 */
export const clickedTrackId = writable<string | null>(null)
/**
 * Track hovered in the set list: mirrored as a subtle halo on
 * the wheel node and a tint on the Tracks-view row, so the eye can find the
 * same track across views. Never persisted, cleared on mouse-leave.
 */
export const hoveredId = writable<string | null>(null)

/**
 * Walk-draw reveal trigger (session-only): ✨/⚡ bumps the tick and
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
/** The `s` hotkey asks whichever set panel is mounted to run ✨. */
export const suggestHotkeyTick = writable(0)
/** Guided-tour position: null = closed; session-only. */
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
  // window in the same breath: callers that gate on "still drawing" — the
  // wheel hub, the ⚡ offer — must not be held for seconds by an animation
  // nobody is being shown.
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
 * Multiple named sets (persisted): always at least one; the active one is
 * what the wheel/panel edit. `tracklist` below keeps its original
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
 * Write fields of the active set in ONE update — one store notification,
 * so one undo step however many fields change. Leaves `generated` alone:
 * marking a track is not editing the walk.
 */
export function patchActiveSet(patch: Partial<Omit<TrackSet, 'id'>>): void {
  sets.update(($sets) => {
    const current = activeSetOf($sets, get(activeSetId))
    return $sets.map((s) => (s.id === current.id ? { ...s, ...patch } : s))
  })
}

/**
 * One mark field of the active set as a plain Writable, so readers keep the
 * store API while the value lives on the set. `distinct` by identity: the
 * active set is a new object on every tracklist edit, and an unchanged mark
 * list must not re-emit into the filters and the undo watcher.
 */
function activeSetField<K extends 'mustInclude' | 'pinnedFirst' | 'pinnedLast'>(
  key: K,
): Writable<TrackSet[K]> {
  const store = distinct(
    derived(activeSet, ($active) => $active[key]),
    (a, b) => a === b,
  )
  return {
    subscribe: store.subscribe,
    set: (value) => patchActiveSet({ [key]: value }),
    update: (fn) => patchActiveSet({ [key]: fn(get(store)) }),
  }
}

/**
 * Append a track to the active set — shared by the wheel's double-click and
 * the Tracks table. The same track may appear twice in a set, just not
 * back-to-back.
 */
function appendToSet(id: string): void {
  tracklist.update((ids) => (ids[ids.length - 1] === id ? ids : [...ids, id]))
}

/**
 * Add a track to the active set: if the anchor track is already in the
 * set, splice the new one right after its FIRST occurrence; otherwise append.
 * The anchor defaults to the live selection, but the wheel passes it
 * explicitly — a double-click's two preceding `click` events have already
 * moved and then cleared `selectedId` by the time `ondblclick` runs.
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
 * `inheritMarks` copies the active set's ★ and pins: ✨ forking a new set
 * from a hand-edited one must still honour the marks the user just set.
 */
export function addSet(inheritMarks = false): void {
  if (!canAddSet(get(sets))) return
  const { mustInclude, pinnedFirst, pinnedLast } = get(activeSet)
  const set: TrackSet = {
    ...freshFirstSet(),
    name: nextSetName(get(sets).map((s) => s.name)),
    ...(inheritMarks ? { mustInclude: [...mustInclude], pinnedFirst, pinnedLast } : {}),
  }
  sets.update(($sets) => [...$sets, set])
  activeSetId.set(set.id)
}

/**
 * Rename a set; a name another set already holds gains a " (2)" suffix —
 * names key nothing internally, but an ambiguous dropdown helps no one.
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
  // Activate the neighbour BEFORE the list shrinks: the other order briefly
  // resolves a stale activeSetId to sets[0], flashing another set's marks
  // through the filters and the undo stack.
  if (get(activeSetId) === id) {
    activeSetId.set(remaining[Math.max(0, index - 1)].id)
  }
  sets.set(remaining)
}

/**
 * The active set's pinned opener/closer: DJs often fix the first and last
 * track and regenerate the middle.
 */
export const pinnedFirst = activeSetField('pinnedFirst')
export const pinnedLast = activeSetField('pinnedLast')

/**
 * The active set's ★ essentials: a hard guarantee — the suggester reserves
 * slots and forces edges if needed so every one lands in the walk.
 */
export const mustInclude = activeSetField('mustInclude')

/**
 * Manual edges: user-marked "these mix well" pairs — planning annotations,
 * persisted with the project, never a play log. Toggled from the
 * selected-track card's link mode; pruned when a track leaves the library.
 * Declared up here (with the other engine inputs) so the effective layer and
 * the derivations below can consume it without a TDZ.
 */
export const manualEdges = writable<ManualEdge[]>([])

/**
 * Easy mode COMPUTES WITH defaults — it never mutates the stored advanced
 * state (which keeps feeding persist + undo). Playlist selection and the
 * created sets stay SHARED; criteria/filters/settings force to defaults and
 * manual edges go inactive. These are separate derived stores swapped into
 * the engine-consuming derivations and the component call sites — the
 * writables themselves are left untouched, so flipping back to All controls
 * returns every stored value exactly as it was. structuredClone keeps the
 * DEFAULT_* objects from being aliased and accidentally mutated by a
 * consumer.
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
        ...chromeOf($s),
        // The palette too: the accent reads the stored scheme (theme.ts), so a
        // reset scheme here would paint default-blue nodes in the user's chrome.
        colorScheme: $s.colorScheme,
      }
    : $s,
)
export const effectiveManualEdges = derived([manualEdges, easyMode], ([$m, $e]) => ($e ? [] : $m))

/**
 * Wrap a store so subscribers are only notified when the value actually
 * changes per `equal`, not merely re-derived to a new reference.
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

/**
 * Throttle a store with a trailing edge: the first write after an idle
 * period passes through synchronously (a checkbox toggle stays instant), then
 * at most one emission per `ms` while writes keep coming (a slider drag emits
 * ~4×/s at 250ms instead of once per pixel), and the last value is always
 * delivered. The gate in front of every heavy derivation below.
 *
 * `initial` covers the one cold path: the app keeps these stores permanently
 * subscribed (CriteriaPanel never unmounts), but a `get()` on a cold store
 * inside the throttle window would otherwise read `undefined`.
 */
function throttled<T>(store: Readable<T>, ms: number, initial: T): Readable<T> {
  let lastEmit = -Infinity
  let timer: ReturnType<typeof setTimeout> | undefined
  return derived(
    store,
    ($value, set) => {
      clearTimeout(timer)
      const wait = ms - (Date.now() - lastEmit)
      if (wait <= 0) {
        lastEmit = Date.now()
        set($value)
      } else {
        timer = setTimeout(() => {
          lastEmit = Date.now()
          set($value)
        }, wait)
      }
    },
    initial,
  )
}

/** One throttle window for every tuning control that feeds heavy recomputes. */
const TUNING_THROTTLE_MS = 250

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
 * The marks quick-filters' live context: `null`
 * while `starredOnly`/`comboOnly`/`constellationOnly` are all off, so
 * `visibleLibrary` stays inert to mustInclude/pin/manualEdges/tracklist
 * churn — the perf gate, since `visibleLibrary` feeds the combo graph and
 * its pair count, which would otherwise rebuild on every star click (or
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
 * the cost is one extra pass of the heavy derivations on those boundary
 * clicks only.
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
 * routes through: TracksView's header ★/🔗,
 * FiltersSection's all/only switches, and AdvancedMenu's hide-clears branch
 * and "Reset settings" button all call this instead of poking
 * `filters.marks` directly.
 *
 * Early-returns when `value` already matches — without it, a no-op click
 * (re-clicking the already-active "only" button, hiding an already-off row,
 * resetting an already-off flag) still writes `filters`, which cascades
 * into `marksContext`/`visibleLibrary` — the `distinct` wrapper guards the
 * heavy derivations (the combo graph's pair count, the wheel layout)
 * against real churn, not this kind of no-op.
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

/** Neutralise the filter a pseudo row owns, whatever backs it: a
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
 * The library with analysed values filling the nulls Rekordbox left.
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
 * The source preference, projected through `distinct` so unrelated
 * settings churn (an edge-opacity slider drag) never re-emits into the
 * library-wide derivations downstream. Reads the EFFECTIVE layer: easy mode runs
 * on Rekordbox truth like every other computed default.
 */
const sourcePrefs = distinct(
  derived(effectiveSettings, ($s) => ({ keySource: $s.keySource, bpmSource: $s.bpmSource })),
  (a, b) => a.keySource === b.keySource && a.bpmSource === b.bpmSource,
)
/**
 * Comment-sourced key/BPM substitution, BEFORE the sidecar merge: the
 * fallback chain is comment token → Rekordbox value → analysis sidecar,
 * and a comment-sourced key is non-null so the sidecar never fills-and-badges
 * it. Identity when both prefs are 'rekordbox'.
 */
const sourced = derived([library, sourcePrefs], ([$library, $prefs]) =>
  applySourcePreference($library, $prefs),
)
/** The genre preference, `distinct` for the same reason as `sourcePrefs`:
 * it feeds every library-wide derivation, so unrelated settings churn must
 * not re-emit. */
const genrePrefs = distinct(
  derived(effectiveSettings, ($s) => ({
    genreSource: $s.genreSource,
    genreThreshold: $s.genreThreshold,
  })),
  (a, b) => a.genreSource === b.genreSource && a.genreThreshold === b.genreThreshold,
)
const merged = derived([sourced, analysis, genrePrefs], ([$sourced, $analysis, $genrePrefs]) => {
  // The sample collection's own analysis joins alongside the user's sidecar
  // rather than replacing it: its fictional paths never match a real track,
  // and a multi-hour analysis run must survive a look at the sample.
  const sidecar = $analysis === null ? SAMPLE_ANALYSIS : mergeSidecars(SAMPLE_ANALYSIS, $analysis)
  const result = mergeAnalysis($sourced, sidecar, $genrePrefs)
  // The own-label ↔ predicted-style aliases are module state in genre.ts:
  // every matcher — wheel, genre map, set panel, suggestions — must read the
  // same table, and this is the one place a new merge is seen before
  // anything downstream matches on genre.
  setGenreBridge(result.genreBridge)
  return result
})
export const augmentedLibrary = derived(merged, ($merged) => $merged.tracks)
/**
 * The own-label ↔ predicted-style aliases this library supports.
 * Exported for the advanced menu's count; the matchers read the installed
 * copy in genre.ts, never this store.
 */
export const genreBridge = derived(merged, ($merged) => $merged.genreBridge)
/** Which fields on which track came from analysis — drives the provenance badges. */
export const analysedFieldsById = derived(merged, ($merged) => $merged.analysedFields)

/**
 * Whether any analysis actually reached this library — a filled value, a
 * descriptor token read from a comment, or a predicted genre. The analysis
 * columns, filters and genre-source controls stay out of sight until it
 * does: a DJ without the analyser should not meet empty descriptor columns.
 * Join-based, so an analysis file for other tracks (or the sample's) never
 * counts.
 */
export const hasAnalysis = derived(
  merged,
  ($merged) =>
    $merged.analysedFields.size > 0 || $merged.tracks.some((t) => t.analysedGenre !== null),
)

/**
 * Id → track for the surfaces that DISPLAY metadata.
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
 * Distinct genres present in the SELECTED PLAYLISTS, alphabetical: a
 * whole-collection checklist drowns the playlists you actually work in.
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
 * Criteria as the combo engine sees them: throttled, so a slider drag
 * or a number-input keystroke burst rebuilds the combo graph (and recounts
 * its pairs) a handful of times, not once per input event. Everything else (UI bindings, undo, autosave, tests)
 * keeps reading the synchronous `effectiveCriteria`.
 */
const settledCriteria = throttled(
  effectiveCriteria,
  TUNING_THROTTLE_MS,
  structuredClone(DEFAULT_CRITERIA),
)

/** The genre criterion's k on its own: a primitive, so only a k change rebuilds the matcher. */
const genreK = derived(settledCriteria, ($c) => $c.genre.k)

/**
 * THE genre predicate — the wheel's edges, the set panel's transition chips,
 * the genre map and the suggestions all match with it. Its vocabulary is the
 * whole library, not the visible part: mutual top-k ranks genres against each
 * other, so a vocabulary that followed the filters would let hiding one genre
 * change whether two others match. Downstream of `merged`, which installs the
 * learned genre bridge first.
 */
export const genreMatcher = derived([augmentedLibrary, genreK], ([$augmentedLibrary, $k]) =>
  makeGenreMatcher(
    $augmentedLibrary.map((t) => t.genre),
    $k,
  ),
)

/**
 * The combo graph over the visible library. Lazy: building it costs nothing,
 * and each track's partners are found (and kept) the first time something
 * asks — the selection's star, the hub, the retry ring.
 */
const comboGraph = derived(
  [visibleLibrary, settledCriteria, genreMatcher],
  ([$visibleLibrary, $settledCriteria, $genreMatcher]) =>
    buildComboGraph($visibleLibrary, $settledCriteria, $genreMatcher),
)

/** Require 0 with nothing demanded: every visible pair is a combo. */
export const comboComplete = derived(comboGraph, ($graph) => $graph.complete)

/** The criteria panel's pair count — estimated past a few hundred thousand pairs. */
export const comboPairCount = derived(comboGraph, ($graph) => countComboPairs($graph))

/**
 * Primitive projection, so svelte's own dedup absorbs unrelated settings
 * churn — an edge-opacity drag no longer recomputes the focus edges.
 */
const focusClusterEdges = derived(effectiveSettings, ($s) => $s.focusClusterEdges)

/**
 * The combo edges the wheel draws: the star around the selected track, plus
 * the cluster's interconnections when the setting asks. No selection = no
 * edges. On a complete graph the star is every other visible track, and the
 * cluster option is ignored, since "the cluster" would be every pair.
 */
export const focusEdges = derived(
  [comboGraph, selectedId, focusClusterEdges],
  ([$graph, $selectedId, $focusClusterEdges]) => {
    if (!$graph.complete) return focusEdgesFor($graph, $selectedId, $focusClusterEdges)
    if ($selectedId === null || !$graph.tracks.some((t) => t.id === $selectedId)) return []
    return $graph.tracks
      .filter((t) => t.id !== $selectedId)
      .map((t) => ({ sourceId: $selectedId, targetId: t.id, matched: [] }))
  },
)

/**
 * Node shapes by curated genre family — deterministic, never reshuffled by
 * criteria. Scoped to the selected playlists: range/genre filtering never
 * re-classes, playlist toggles deliberately do.
 */
export const iconClasses = derived(playlistScopedLibrary, ($scoped) =>
  genreFamilyClasses($scoped.map((t) => t.genre)),
)

/**
 * The slot-spread setting on its own: the wheel's per-slot relaxation
 * (relaxSlotAngles, O(m²) per Camelot slot) reads THIS, so unrelated settings
 * writes never re-trigger it and a spread-slider drag coalesces to the
 * throttle window instead of relaxing per pixel.
 */
export const slotSpreadFactor = throttled(
  derived(effectiveSettings, ($s) => $s.slotSpreadFactor),
  TUNING_THROTTLE_MS,
  DEFAULT_SETTINGS.slotSpreadFactor,
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
 * A click in link mode (shared by the wheel and the tracks table): an
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
  // feeds should keep playing it rather than empty itself. Through null first,
  // because a store does not re-announce an unchanged value — and a deck
  // cleared by a re-import must still hear the next click on the same track.
  clickedTrackId.set(null)
  clickedTrackId.set(id)
  selectedId.update((current) => (current === id ? null : id))
}

/** Link mode: the selected track is armed; the next wheel click marks/unmarks. */
export const linkArmed = writable(false)

/**
 * Adjacency: the ids a track shares a combo with, manual pairs included, so
 * the hub, retry ring and focus star all treat a marked combo as a road.
 * Computed per track on first ask. On a complete graph only the manual pairs
 * are listed — every consumer checks `comboComplete` first.
 */
export const neighbours = derived(
  [comboGraph, effectiveManualEdges],
  ([$graph, $effectiveManualEdges]) => {
    const manual = new Map<string, string[]>()
    for (const { a, b } of $effectiveManualEdges) {
      manual.set(a, [...(manual.get(a) ?? []), b])
      manual.set(b, [...(manual.get(b) ?? []), a])
    }
    const memo = new Map<string, ReadonlySet<string>>()
    return {
      get(id: string): ReadonlySet<string> {
        let found = memo.get(id)
        if (found === undefined) {
          found = new Set([
            ...($graph.complete ? [] : $graph.partners(id)),
            ...(manual.get(id) ?? []),
          ])
          memo.set(id, found)
        }
        return found
      },
    }
  },
)
