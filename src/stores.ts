import { derived, get, writable, type Writable } from 'svelte/store'
import {
  computeComboView,
  focusEdges as computeFocusEdges,
  DEFAULT_CRITERIA,
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
import type { ImportReport, ManualEdge, Playlist, Track } from './core/model'
import { canAddSet, freshFirstSet, nextSetName, uniqueSetName, type TrackSet } from './core/sets'
import { DEFAULT_SETTINGS, type AppSettings } from './core/settings'
import type { TrackSort } from './core/trackSort'

type RadialAxis = 'bpm' | 'rating' | 'year' | 'energy'
type ColorAxis = 'auto' | RadialAxis
type ViewMode = 'wheel' | 'genres' | 'tracks'

export const library = writable<Track[]>([])
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
  $e ? structuredClone(DEFAULT_CRITERIA) : $c,
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
      }
    : $s,
)
export const effectiveManualEdges = derived([manualEdges, easyMode], ([$m, $e]) => ($e ? [] : $m))

/** The filtered library: what the wheel, edges and suggestions operate on. */
export const visibleLibrary = derived(
  [library, effectiveFilters, playlists],
  ([$library, $effectiveFilters, $playlists]) =>
    applyFilters($library, $effectiveFilters, $playlists),
)

/**
 * The library scoped to the playlist selection only (ranges and genres are
 * ignored): the range-filter defaults and the radial axis fallback derive
 * from this, so they follow the playlists you are actually working in.
 */
export const playlistScopedLibrary = derived(
  [library, filters, playlists],
  ([$library, $filters, $playlists]) =>
    applyPlaylistFilter($library, $filters.playlists, $playlists),
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
  ([$edges, $selectedId, $settings, $comboComplete, $visibleLibrary]) => {
    if ($comboComplete) {
      if ($selectedId === null) return []
      return $visibleLibrary
        .filter((t) => t.id !== $selectedId)
        .map((t) => ({ sourceId: $selectedId, targetId: t.id, matched: [] }))
    }
    return computeFocusEdges($edges, $selectedId, $settings.focusClusterEdges)
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

export const trackById = derived(library, ($library) => new Map($library.map((t) => [t.id, t])))

export function toggleManualEdge(a: string, b: string): void {
  if (a === b) return
  manualEdges.update(($edges) => {
    const existing = $edges.findIndex((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))
    if (existing !== -1) return $edges.toSpliced(existing, 1)
    return [...$edges, { a, b }]
  })
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
