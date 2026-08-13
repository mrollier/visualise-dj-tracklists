import type { ManualEdge } from './model'

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
