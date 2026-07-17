import { TRACK_PROPERTIES } from './properties'
import type { TrackSortField } from './trackSort'

/**
 * The Tracks-table column model (v9 issue 12): `settings.trackColumns` always
 * holds EVERY column in display order, `settings.hiddenColumns` carries
 * visibility. Toggling a column only edits the hidden list, so re-enabling
 * restores its exact previous position — including custom drag order.
 *
 * Since v11 (issue 1) the canonical order and labels derive from the one
 * property registry in `properties.ts`; this module keeps the column-shaped
 * API the table and migrations consume.
 */

/** Canonical column order: the classic seven, then the rest of the metadata. */
export const ALL_TRACK_COLUMNS: readonly TrackSortField[] = TRACK_PROPERTIES.map((p) => p.key)

export const COLUMN_LABELS: Record<TrackSortField, string> = Object.fromEntries(
  TRACK_PROPERTIES.map((p) => [p.key, p.label]),
) as Record<TrackSortField, string>

/** Everything beyond the classic seven starts hidden. */
export const DEFAULT_HIDDEN_COLUMNS: readonly TrackSortField[] = ALL_TRACK_COLUMNS.slice(7)

/** The columns the table actually renders, in display order. */
export function visibleColumns(
  order: readonly TrackSortField[],
  hidden: readonly TrackSortField[],
): TrackSortField[] {
  const hiddenSet = new Set(hidden)
  return order.filter((field) => !hiddenSet.has(field))
}

function isField(value: unknown): value is TrackSortField {
  return typeof value === 'string' && (ALL_TRACK_COLUMNS as readonly string[]).includes(value)
}

/**
 * Normalize saved column settings, whatever their vintage: sanitize and
 * dedupe the saved order, append the canonical fields it lacks (in canonical
 * order), and hide the appended ones — a column the save never knew about
 * must not pop into view on upgrade (v11: `location`). For saves predating
 * `hiddenColumns` that reproduces the old visible set exactly. A save can
 * never end up with everything hidden: title is forced back on.
 */
export function migrateColumns(
  rawColumns: unknown,
  rawHidden: unknown,
): { trackColumns: TrackSortField[]; hiddenColumns: TrackSortField[] } {
  if (!Array.isArray(rawColumns)) {
    return { trackColumns: [...ALL_TRACK_COLUMNS], hiddenColumns: [...DEFAULT_HIDDEN_COLUMNS] }
  }
  const trackColumns = [...new Set(rawColumns.filter(isField))]
  const appended: TrackSortField[] = []
  for (const field of ALL_TRACK_COLUMNS) {
    if (!trackColumns.includes(field)) {
      trackColumns.push(field)
      appended.push(field)
    }
  }
  const hiddenColumns = Array.isArray(rawHidden)
    ? [...new Set([...rawHidden.filter(isField), ...appended])]
    : appended
  if (hiddenColumns.length >= trackColumns.length) {
    hiddenColumns.splice(hiddenColumns.indexOf('title'), 1)
  }
  return { trackColumns, hiddenColumns }
}
