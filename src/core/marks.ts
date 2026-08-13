import { applyPlaylistFilter } from './filter'
import type { ManualEdge, Playlist, Track } from './model'

/**
 * The "marks" quick-filters (v18 #3/#8): two library-level toggles that
 * narrow the wheel to tracks carrying a session mark — starred (any
 * non-none star state, `pins.ts`'s `StarState`) or a manual-combo endpoint.
 * Both booleans live on `LibraryFilters.marks` (filter.ts) and AND together
 * with every other filter dimension there. Unlike every other filter field,
 * a saved-active marks filter is never honoured on load — see filter.ts's
 * `migrateFilters` for why.
 */
export interface MarksFilter {
  starredOnly: boolean
  comboOnly: boolean
}

/**
 * The pseudo-property keys `settings.visibleFilters` and `persist.ts`'s
 * `validFilterKeys` recognize for the two marks rows, alongside every real
 * `TrackSortField`. Order is display order (starred before combos).
 */
export const MARK_FILTER_KEYS = ['starred', 'combos'] as const
export type MarkFilterKey = (typeof MARK_FILTER_KEYS)[number]

export function isMarkFilterKey(k: string): k is MarkFilterKey {
  return (MARK_FILTER_KEYS as readonly string[]).includes(k)
}

/** One registry row's shape — see `MARK_FILTERS` below. */
export interface MarkFilterMeta {
  key: MarkFilterKey
  flag: keyof MarksFilter
  label: string
  aria: string
}

/**
 * Single source of truth for the two marks rows, consumed by every UI
 * surface that renders one (v18 #3/#8 review fix — FiltersSection and
 * AdvancedMenu previously hand-rolled their own label/flag maps, which had
 * already drifted: AdvancedMenu's checkbox aria-labels baked the emoji into
 * the accessible name instead of using a clean `aria` string).
 *
 * `label` puts the glyph FIRST, not last: FiltersSection's `.filter-label`
 * is a fixed 52px with `text-overflow: ellipsis`, which clips from the
 * right — a trailing glyph (the original "Manual combos 🔗") rendered as
 * "Manual c…", losing the icon entirely.
 */
export const MARK_FILTERS: readonly MarkFilterMeta[] = [
  { key: 'starred', flag: 'starredOnly', label: '★ Starred', aria: 'Starred' },
  { key: 'combos', flag: 'comboOnly', label: '🔗 Combos', aria: 'Manual combos' },
] as const

/**
 * The live id sets a marks filter checks membership against, resolved from
 * the session stores just before filtering (`stores.ts`'s `marksContext`).
 * A context is deliberately NOT part of `LibraryFilters` itself — the ids
 * come from session-only stores (mustInclude, the pins, manualEdges), so
 * threading them through as a separate, optional argument to `applyFilters`
 * keeps a stray caller (a test, a future one-off filter preview) safe: no
 * context simply means the marks flags are inert, never "everything hides".
 */
export interface MarksContext {
  starredIds: ReadonlySet<string>
  comboIds: ReadonlySet<string>
}

/**
 * "Starred" = any non-none star state: must-include ∪ the two pins. The
 * Tracks view renders a different glyph per state (★/⏮/⏭ — `pins.ts`'s
 * `StarState`) but treats all three alike via the shared `on` class, not
 * glyph identity — a pinned track has to count as starred here too, not
 * just as a pin.
 */
export function starredIdSet(
  mustInclude: readonly string[],
  pinnedFirst: string | null,
  pinnedLast: string | null,
): Set<string> {
  const out = new Set(mustInclude)
  if (pinnedFirst !== null) out.add(pinnedFirst)
  if (pinnedLast !== null) out.add(pinnedLast)
  return out
}

/** Every track id that is an endpoint of at least one manual combo edge. */
export function comboIdSet(edges: readonly ManualEdge[]): Set<string> {
  const out = new Set<string>()
  for (const edge of edges) {
    out.add(edge.a)
    out.add(edge.b)
  }
  return out
}

/**
 * The scope a bulk-clear button acts on (v18 #3, Task 8 — the Advanced
 * menu's "Clear ★ marks" / "Clear 🔗 combos" buttons): reuses `filter.ts`'s
 * `applyPlaylistFilter` for the actual playlist-membership semantics
 * (including the `NOT_IN_PLAYLIST` pseudo-entry), so this never
 * reimplements that logic — EXCEPT for one deliberate difference: an empty
 * selection (`[]`) also falls back to the whole library here, not
 * `applyPlaylistFilter`'s "nothing" (the empty-wheel default for a fresh
 * playlisted import, design-v5 §D). A bulk-clear button reading the same
 * `filters.playlists` state must not silently become a no-op scope when
 * nothing is ticked — "no selection" is exactly the case the confirm
 * dialog's "across the whole library" copy describes, so the scope has to
 * actually BE the whole library for that copy to be true.
 */
export function bulkScopeIds(
  library: Track[],
  selected: string[] | null,
  playlists: Playlist[],
): Set<string> {
  if (selected === null || selected.length === 0) return new Set(library.map((t) => t.id))
  return new Set(applyPlaylistFilter(library, selected, playlists).map((t) => t.id))
}

/**
 * Clear the ★ mark (must-include ∪ both pins, `starredIdSet`) from every
 * track in `scope` (v18 #3, Task 8): the Advanced menu's "Clear ★ marks"
 * button. Anything outside `scope` survives untouched — a pin only clears
 * when the PINNED TRACK ITSELF is in scope, exactly like a must-include id
 * only drops when IT is in scope; a pin pointing outside `scope` survives
 * even while must-include ids or the OTHER pin inside `scope` are being
 * cleared. `cleared` counts distinct tracks that lose their star — the same
 * union `starredIdSet` computes, intersected with `scope` — so a track that
 * is both must-include AND a pin counts once, not twice: one number, the
 * same one the button's live count and confirm-dialog body show.
 */
export function clearStarsInScope(
  scope: ReadonlySet<string>,
  mustInclude: readonly string[],
  pinnedFirst: string | null,
  pinnedLast: string | null,
): {
  mustInclude: string[]
  pinnedFirst: string | null
  pinnedLast: string | null
  cleared: number
} {
  const before = starredIdSet(mustInclude, pinnedFirst, pinnedLast)
  let cleared = 0
  for (const id of before) if (scope.has(id)) cleared += 1
  return {
    mustInclude: mustInclude.filter((id) => !scope.has(id)),
    pinnedFirst: pinnedFirst !== null && scope.has(pinnedFirst) ? null : pinnedFirst,
    pinnedLast: pinnedLast !== null && scope.has(pinnedLast) ? null : pinnedLast,
    cleared,
  }
}

/**
 * Remove every manual combo edge touching `scope` (v18 #3, Task 8): the
 * Advanced menu's "Clear 🔗 combos" button. An edge drops when EITHER
 * endpoint is in scope, not only when both are — a combo that crosses the
 * scope boundary (one end inside the selected playlists, one end outside)
 * still anchors a relationship on an in-scope track, so it goes too; only an
 * edge with BOTH ends outside `scope` survives.
 */
export function clearCombosInScope(
  scope: ReadonlySet<string>,
  edges: readonly ManualEdge[],
): { edges: ManualEdge[]; cleared: number } {
  const kept = edges.filter((e) => !scope.has(e.a) && !scope.has(e.b))
  return { edges: kept, cleared: edges.length - kept.length }
}
