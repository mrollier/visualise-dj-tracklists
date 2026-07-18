import type { Track } from './model'
import type { TrackSortField } from './trackSort'

/**
 * The one registry of track properties (v11 issue 1). Every non-id `Track`
 * field appears exactly once, carrying everything the UI needs to show it as
 * a Tracks-table column or a left-panel filter: label, value kind, and cell
 * formatting. `columns.ts` derives its order/labels from here; the filter
 * engine derives each property's range semantics from `kind`.
 */

/** How a property's values compare, filter and render. */
export type PropertyKind = 'text' | 'number' | 'date' | 'key'

export interface TrackProperty {
  key: TrackSortField
  label: string
  kind: PropertyKind
  /** All true today; the flag exists so a future kind (e.g. a colour
   *  checklist) can opt a property out of range filtering without engine
   *  special cases. */
  filterable: boolean
  /** Cell-text override for the Tracks table (duration m:ss, size MB). */
  format?: (value: string | number) => string
}

function formatDuration(value: string | number): string {
  const secs = Math.round(Number(value))
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
}

function formatSize(value: string | number): string {
  return `${(Number(value) / (1024 * 1024)).toFixed(1)} MB`
}

function prop(
  key: TrackSortField,
  label: string,
  kind: PropertyKind,
  format?: (value: string | number) => string,
): TrackProperty {
  return { key, label, kind, filterable: true, format }
}

/** Canonical order: the classic seven, the rest of the metadata, location last. */
export const TRACK_PROPERTIES: readonly TrackProperty[] = [
  prop('artist', 'Artist', 'text'),
  prop('title', 'Title', 'text'),
  prop('key', 'Key', 'key'),
  prop('bpm', 'BPM', 'number'),
  prop('genre', 'Genre', 'text'),
  prop('year', 'Year', 'number'),
  prop('rating', 'Rating', 'number'),
  prop('energy', 'Energy', 'number'),
  prop('album', 'Album', 'text'),
  prop('dateAdded', 'Date added', 'date'),
  prop('durationSec', 'Length', 'number', formatDuration),
  prop('composer', 'Composer', 'text'),
  prop('grouping', 'Grouping', 'text'),
  prop('remixer', 'Remixer', 'text'),
  prop('label', 'Label', 'text'),
  prop('mix', 'Mix', 'text'),
  prop('comments', 'Comments', 'text'),
  prop('playCount', 'Play count', 'number'),
  prop('lastPlayed', 'Last played', 'date'),
  prop('colour', 'Colour', 'text'),
  prop('trackNumber', 'Track #', 'number'),
  prop('discNumber', 'Disc #', 'number'),
  prop('bitRate', 'Bit rate', 'number'),
  prop('sampleRate', 'Sample rate', 'number'),
  prop('kind', 'Kind', 'text'),
  prop('size', 'Size', 'number', formatSize),
  prop('dateModified', 'Date modified', 'date'),
  prop('location', 'Location', 'text'),
]

export const PROPERTY_BY_KEY: ReadonlyMap<TrackSortField, TrackProperty> = new Map(
  TRACK_PROPERTIES.map((p) => [p.key, p]),
)

/**
 * The property filters shown in the left panel by default (v11 issue 1 —
 * reverting the v10 Date-added default). The rest are opt-in via the
 * advanced "Track properties" table.
 */
export const DEFAULT_VISIBLE_FILTERS: readonly TrackSortField[] = ['bpm', 'year', 'rating']

/** Cell text for the Tracks table: '—' for missing, kind formatting else. */
export function formatPropertyValue(track: Track, key: TrackSortField): string {
  const value = track[key]
  if (value === null) return '—'
  const format = PROPERTY_BY_KEY.get(key)?.format
  return format !== undefined ? format(value) : String(value)
}
