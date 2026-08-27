import { ALL_CAMELOT_KEYS } from './keys'
import type { Track } from './model'

/**
 * Column sorting for the Tracks table view (issue 7). Strings compare per
 * locale, numbers numerically, keys in Camelot-wheel order ("2A" before
 * "10A"; the A wheel before B). Missing values sink to the bottom in both
 * directions — a null BPM is never "the slowest track".
 */
export type TrackSortField =
  | 'artist'
  | 'title'
  | 'key'
  | 'bpm'
  | 'genre'
  | 'year'
  | 'rating'
  | 'energy'
  | 'arousal'
  | 'valence'
  | 'danceability'
  | 'happiness'
  | 'album'
  | 'dateAdded'
  | 'durationSec'
  | 'composer'
  | 'grouping'
  | 'kind'
  | 'size'
  | 'discNumber'
  | 'trackNumber'
  | 'bitRate'
  | 'sampleRate'
  | 'comments'
  | 'playCount'
  | 'remixer'
  | 'label'
  | 'mix'
  | 'colour'
  | 'dateModified'
  | 'lastPlayed'
  | 'location'

export interface TrackSort {
  field: TrackSortField
  dir: 'asc' | 'desc'
}

const KEY_ORDER = new Map(ALL_CAMELOT_KEYS.map((key, i) => [key as string, i]))

// One shared collator: localeCompare with an options object resolves a
// Collator PER CALL, which dominates the sort at O(n log n) comparisons.
const collator = new Intl.Collator(undefined, { sensitivity: 'base' })

/** Deterministic tiebreak on internal ids — code-unit order, locale-free. */
function compareIds(a: Track, b: Track): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** null = missing (sinks); number = comparable rank; string = locale text. */
function sortValue(track: Track, field: TrackSortField): number | string | null {
  const value = track[field]
  if (value === null) return null
  if (field === 'key') return KEY_ORDER.get(value as string) ?? null
  return value
}

export function sortTracks(tracks: readonly Track[], sort: TrackSort): Track[] {
  const sign = sort.dir === 'asc' ? 1 : -1
  return [...tracks].sort((a, b) => {
    const va = sortValue(a, sort.field)
    const vb = sortValue(b, sort.field)
    if (va === null && vb === null) return compareIds(a, b)
    if (va === null) return 1 // missing sinks regardless of direction
    if (vb === null) return -1
    const cmp =
      typeof va === 'string' || typeof vb === 'string'
        ? collator.compare(String(va), String(vb))
        : va - vb
    return sign * cmp || compareIds(a, b)
  })
}
