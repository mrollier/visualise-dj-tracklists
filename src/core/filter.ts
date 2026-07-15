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
}

/** Pseudo-playlist name: tracks that appear in no playlist at all. */
export const NOT_IN_PLAYLIST = '__not-in-a-playlist__'

export const EMPTY_FILTERS: LibraryFilters = {
  bpm: null,
  year: null,
  rating: null,
  genres: null,
  playlists: null,
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

function inRange(value: number | null, range: [number, number] | null): boolean {
  if (range === null || value === null) return true
  return value >= range[0] && value <= range[1]
}

export function applyFilters(
  tracks: Track[],
  filters: LibraryFilters,
  playlists: Playlist[] = [],
): Track[] {
  const allowed =
    filters.genres === null ? null : new Set(filters.genres.map((g) => g.toLowerCase()))
  let allowedIds: Set<string> | null = null
  if (filters.playlists !== null && playlists.length > 0) {
    const selected = new Set(filters.playlists)
    allowedIds = new Set<string>()
    for (const playlist of playlists) {
      if (!selected.has(playlist.name)) continue
      for (const id of playlist.trackIds) allowedIds.add(id)
    }
    if (selected.has(NOT_IN_PLAYLIST)) {
      const inAny = new Set(playlists.flatMap((p) => p.trackIds))
      for (const track of tracks) {
        if (!inAny.has(track.id)) allowedIds.add(track.id)
      }
    }
  }
  return tracks.filter(
    (t) =>
      inRange(t.bpm, filters.bpm) &&
      inRange(t.year, filters.year) &&
      inRange(t.rating, filters.rating) &&
      (allowed === null || t.genre === null || allowed.has(t.genre.toLowerCase())) &&
      (allowedIds === null || allowedIds.has(t.id)),
  )
}
