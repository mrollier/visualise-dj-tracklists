import { camelotRing } from './keys'
import type { Playlist, Track } from './model'

/**
 * Library-level filters (remarks 2, 6, 8): they decide which tracks are
 * visible at all — on the wheel, in the combo graph, and for suggestions.
 * A null range/list means "not filtering on this field". A track missing a
 * value never fails a range filter (consistent with the combo engine's
 * missing-data policy); genre-less tracks likewise always pass.
 */
export interface LibraryFilters {
  bpm: [number, number] | null
  year: [number, number] | null
  rating: [number, number] | null
  /** Allow-list of genres (compared case-insensitively); null = all genres. */
  genres: string[] | null
  /**
   * Selected playlist names (may include NOT_IN_PLAYLIST); null = the
   * playlist filter is inactive. A fresh collection import with playlists
   * starts at [] — nothing selected, empty wheel (design-v5 §D).
   */
  playlists: string[] | null
  /**
   * Show only one Camelot ring (minor = A/inner, major = B/outer). Lives
   * with the key criterion in the UI but is a visibility filter; keyless
   * tracks always pass (v8 issue 10).
   */
  keyRing: 'both' | 'minor' | 'major'
}

/** Pseudo-playlist name: tracks that appear in no playlist at all. */
export const NOT_IN_PLAYLIST = '__not-in-a-playlist__'

export const EMPTY_FILTERS: LibraryFilters = {
  bpm: null,
  year: null,
  rating: null,
  genres: null,
  playlists: null,
  keyRing: 'both',
}

export interface LibraryExtents {
  bpm: [number, number] | null
  year: [number, number] | null
  rating: [number, number] | null
}

/**
 * Min/max of each filterable numeric field over the library (missing values
 * ignored; null when no track has the field). The filter inputs default to
 * these, so freshly imported libraries start with their true ranges visible.
 */
export function libraryExtents(tracks: Track[]): LibraryExtents {
  const extent = (field: 'bpm' | 'year' | 'rating'): [number, number] | null => {
    const values = tracks.map((t) => t[field]).filter((v): v is number => v !== null)
    return values.length === 0 ? null : [Math.min(...values), Math.max(...values)]
  }
  return { bpm: extent('bpm'), year: extent('year'), rating: extent('rating') }
}

/**
 * Whole numbers just outside the extent: [floor(min), ceil(max)]. The range
 * filters reset to these, so the bounds read cleanly and still cover every
 * track in the current selection.
 */
export function wholeExtent(extent: [number, number]): [number, number] {
  return [Math.floor(extent[0]), Math.ceil(extent[1])]
}

/**
 * Keep min <= max by pulling the side the user just edited to the other
 * bound (editing min past max collapses onto max, and vice versa).
 */
export function clampRange(range: [number, number], edited: 'min' | 'max'): [number, number] {
  const [min, max] = range
  if (min <= max) return range
  return edited === 'min' ? [max, max] : [min, min]
}

function inRange(value: number | null, range: [number, number] | null): boolean {
  if (range === null || value === null) return true
  return value >= range[0] && value <= range[1]
}

/** The track ids the playlist selection allows, or null when it is inert. */
function playlistMemberIds(
  tracks: Track[],
  selected: string[] | null,
  playlists: Playlist[],
): Set<string> | null {
  if (selected === null || playlists.length === 0) return null
  const chosen = new Set(selected)
  const allowedIds = new Set<string>()
  for (const playlist of playlists) {
    if (!chosen.has(playlist.name)) continue
    for (const id of playlist.trackIds) allowedIds.add(id)
  }
  if (chosen.has(NOT_IN_PLAYLIST)) {
    const inAny = new Set(playlists.flatMap((p) => p.trackIds))
    for (const track of tracks) {
      if (!inAny.has(track.id)) allowedIds.add(track.id)
    }
  }
  return allowedIds
}

/**
 * Just the playlist part of the filters: the tracks the current playlist
 * selection allows, ignoring ranges and genres. The range-filter defaults
 * (and the radial axis fallback) are scoped to this, not the whole library.
 */
export function applyPlaylistFilter(
  tracks: Track[],
  selected: string[] | null,
  playlists: Playlist[],
): Track[] {
  const allowedIds = playlistMemberIds(tracks, selected, playlists)
  return allowedIds === null ? tracks : tracks.filter((t) => allowedIds.has(t.id))
}

export function applyFilters(
  tracks: Track[],
  filters: LibraryFilters,
  playlists: Playlist[] = [],
): Track[] {
  const allowed =
    filters.genres === null ? null : new Set(filters.genres.map((g) => g.toLowerCase()))
  const allowedIds = playlistMemberIds(tracks, filters.playlists, playlists)
  const ring = filters.keyRing === 'minor' ? 'A' : filters.keyRing === 'major' ? 'B' : null
  return tracks.filter(
    (t) =>
      inRange(t.bpm, filters.bpm) &&
      inRange(t.year, filters.year) &&
      inRange(t.rating, filters.rating) &&
      (allowed === null || t.genre === null || allowed.has(t.genre.toLowerCase())) &&
      (allowedIds === null || allowedIds.has(t.id)) &&
      (ring === null || t.key === null || camelotRing(t.key) === ring),
  )
}
