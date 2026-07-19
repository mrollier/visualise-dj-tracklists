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
export type PropertyKind = 'alpha' | 'number' | 'date' | 'key' | 'contains' | 'colour' | 'quality'

/**
 * Rekordbox colour tags (raw `0xRRGGBB` values as they appear on `track.colour`)
 * mapped to their palette names. Used to label the colour-filter chips.
 */
export const REKORDBOX_COLOURS: Record<string, string> = {
  '0xFF007F': 'Pink',
  '0xFF0000': 'Red',
  '0xFFA500': 'Orange',
  '0xFFFF00': 'Yellow',
  '0x00FF00': 'Green',
  '0x25FDE9': 'Aqua',
  '0x0000FF': 'Blue',
  '0x660099': 'Purple',
}

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
  prop('artist', 'Artist', 'alpha'),
  prop('title', 'Title', 'alpha'),
  prop('key', 'Key', 'key'),
  prop('bpm', 'BPM', 'number'),
  prop('genre', 'Genre', 'alpha'),
  prop('year', 'Year', 'number'),
  prop('rating', 'Rating', 'number'),
  prop('energy', 'Energy', 'number'),
  prop('album', 'Album', 'alpha'),
  prop('dateAdded', 'Date added', 'date'),
  prop('durationSec', 'Length', 'number', formatDuration),
  prop('composer', 'Composer', 'alpha'),
  prop('grouping', 'Grouping', 'alpha'),
  prop('remixer', 'Remixer', 'alpha'),
  prop('label', 'Label', 'alpha'),
  prop('mix', 'Mix', 'alpha'),
  prop('comments', 'Comments', 'contains'),
  prop('playCount', 'Play count', 'number'),
  prop('lastPlayed', 'Last played', 'date'),
  prop('colour', 'Colour', 'colour'),
  prop('trackNumber', 'Track #', 'number'),
  prop('discNumber', 'Disc #', 'number'),
  prop('bitRate', 'Bit rate', 'number'),
  prop('sampleRate', 'Sample rate', 'number'),
  prop('kind', 'Kind', 'quality'),
  prop('size', 'Size', 'number', formatSize),
  prop('dateModified', 'Date modified', 'date'),
  prop('location', 'Location', 'contains'),
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
