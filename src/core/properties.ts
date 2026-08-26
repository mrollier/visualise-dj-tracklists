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
type PropertyKind = 'alpha' | 'number' | 'date' | 'key' | 'contains' | 'colour' | 'quality'

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
  /** All true today; the colour checklist now exists (the `colour` kind) —
   *  the flag remains so a future kind can opt a property out of range
   *  filtering without engine special cases. */
  filterable: boolean
  /** Cell-text override for the Tracks table (duration m:ss, size MB). */
  format?: (value: string | number) => string
  /**
   * What the number means and where it comes from (v35): an InfoTooltip in
   * the filter row, and the column header's native title.
   */
  hint?: string
  /**
   * Every non-null value comes from the analysis sidecar (v35): no DJ library
   * supplies it. Groups the filter row into the collapsed Analysis section so
   * the caveat these share is stated once. Deliberately does NOT suppress the
   * per-cell provenance underline — a column where every filled cell is
   * analysed still has to say so somewhere that survives a screenshot.
   */
  analysisOnly?: true
  /** Upper bound for the filter's number boxes; unbounded when absent. */
  max?: number
}

type PropertyOptions = Pick<TrackProperty, 'format' | 'hint' | 'analysisOnly' | 'max'>

export function formatDuration(value: string | number): string {
  const secs = Math.round(Number(value))
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
}

function formatSize(value: string | number): string {
  return `${(Number(value) / (1024 * 1024)).toFixed(1)} MB`
}

function formatPercent(value: string | number): string {
  return `${value}%`
}

/**
 * The v35 descriptors' shared caveat, shown once on the Analysis filter group
 * rather than repeated in all four hints.
 */
export const ANALYSIS_GROUP_HINT =
  'All four come from one offline analysis run (essentia-tensorflow, 2026-08-25) on models ' +
  'trained on general-purpose music. None has been validated against your ear. Rekordbox ' +
  'never supplies them, so a blank means the track has no analysis entry.'

const DESCRIPTOR = { analysisOnly: true, max: 100, format: formatPercent } as const

function prop(
  key: TrackSortField,
  label: string,
  kind: PropertyKind,
  options: Partial<PropertyOptions> = {},
): TrackProperty {
  return { key, label, kind, filterable: true, ...options }
}

/** Canonical order: the classic seven, the rest of the metadata, location last. */
export const TRACK_PROPERTIES: readonly TrackProperty[] = [
  prop('artist', 'Artist', 'alpha'),
  prop('title', 'Title', 'alpha'),
  prop('key', 'Key', 'key'),
  prop('bpm', 'BPM', 'number'),
  prop('genre', 'Genre', 'alpha'),
  prop('year', 'Year', 'number'),
  prop('rating', 'Rating', 'number', { max: 5 }),
  prop('energy', 'Energy', 'number', {
    hint:
      '1-10. Derived from arousal, unless an "Energy N" comment supplied it directly ' +
      '(Mixed In Key) - then the two can disagree. The Arousal column shows the same ' +
      'measurement on a different curve: energy stretches the 3.5-7.5 band the model ' +
      'actually uses, arousal shows its nominal 1-9, so 10 and 83% can be one track.',
  }),
  prop('arousal', 'Arousal', 'number', {
    ...DESCRIPTOR,
    hint:
      'Model-estimated intensity, 0-100%. From emomusic-msd-musicnn, rescaled from its native ' +
      '1-9. Your library only spans about 28-83% because the model pulls towards its average. ' +
      'Measured unreliable above 155 BPM.',
  }),
  prop('valence', 'Valence', 'number', {
    ...DESCRIPTOR,
    hint:
      'Model-estimated positivity, 0-100%. Same model and the same caveats as Arousal, and the ' +
      'most tempo-entangled of the four.',
  }),
  prop('danceability', 'Danceability', 'number', {
    ...DESCRIPTOR,
    hint:
      'How confident the model is that the track is danceable, 0-100%. From ' +
      'danceability-msd-musicnn. Saturated here - 79% of the library scores above 90 - so it ' +
      'separates ballads from dance tracks, not dance tracks from each other.',
  }),
  prop('happiness', 'Happiness', 'number', {
    ...DESCRIPTOR,
    hint:
      "How confident the model is of its 'happy' class, 0-100%. From mood_happy-msd-musicnn. " +
      'The widest spread of the four, but it tracks genre at least as much as mood.',
  }),
  prop('album', 'Album', 'alpha'),
  prop('dateAdded', 'Date added', 'date'),
  prop('durationSec', 'Length', 'number', { format: formatDuration }),
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
  prop('size', 'Size', 'number', { format: formatSize }),
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
