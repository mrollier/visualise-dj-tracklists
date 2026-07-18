import type { CamelotKey } from './keys'

/** A track = node in the graph. Missing metadata is null, never a guess. */
export interface Track {
  id: string
  title: string
  artist: string | null
  key: CamelotKey | null
  bpm: number | null
  genre: string | null
  year: number | null
  /** 0–5 stars; 0 means "unrated" but present. */
  rating: number | null
  durationSec: number | null
  album: string | null
  /** Rekordbox's DateAdded (when the file entered the library, 'YYYY-MM-DD') — not a release date. */
  dateAdded: string | null
  /** File path or URL from the source library; needed for M3U8 export. */
  location: string | null
  // v9 (issue 10): the remaining Rekordbox collection attributes, so the
  // Tracks-table columns can cover every metadata type the XML carries.
  composer: string | null
  grouping: string | null
  /** File format as Rekordbox names it, e.g. "MP3 File". */
  kind: string | null
  /** File size in bytes. */
  size: number | null
  discNumber: number | null
  trackNumber: number | null
  /** kbit/s. */
  bitRate: number | null
  /** Hz. */
  sampleRate: number | null
  comments: string | null
  /**
   * Mixed-In-Key-style energy 1–10, derived from Comments at import
   * (v12 WS8) — the field is real so filters/columns/radius treat it like
   * any metadata, but no DJ software writes it as a first-class attribute.
   */
  energy: number | null
  /**
   * A record with no digital file (v12 WS13): metadata is hand-entered
   * rather than analysed, and the flag marks provenance in the UI. A flag,
   * not a nullable — "not vinyl" is knowledge, not missing data.
   */
  isVinyl: boolean
  /** 0 is a real count ("never played"), not "unknown". */
  playCount: number | null
  remixer: string | null
  /** Record label. */
  label: string | null
  mix: string | null
  /** Rekordbox colour tag, raw (e.g. "0xFF007F"); rendered as text for now. */
  colour: string | null
  /** 'YYYY-MM-DD', like dateAdded. */
  dateModified: string | null
  /** 'YYYY-MM-DD', like dateAdded. */
  lastPlayed: string | null
}

/**
 * Every non-identity Track field as null — the spread base for importers,
 * sample data and tests, so adding a field never ripples hand-typed nulls
 * through the codebase.
 */
export const EMPTY_TRACK_FIELDS: Omit<Track, 'id' | 'title'> = {
  artist: null,
  key: null,
  bpm: null,
  genre: null,
  year: null,
  rating: null,
  durationSec: null,
  album: null,
  dateAdded: null,
  location: null,
  composer: null,
  grouping: null,
  kind: null,
  size: null,
  discNumber: null,
  trackNumber: null,
  bitRate: null,
  sampleRate: null,
  comments: null,
  energy: null,
  isVinyl: false,
  playCount: null,
  remixer: null,
  label: null,
  mix: null,
  colour: null,
  dateModified: null,
  lastPlayed: null,
}

/**
 * Mixed-In-Key-style energy from a Comments field (v12 WS8): the explicit
 * "Energy N" token (N 1–10), case-insensitive, optional colon/dash. Nothing
 * else — bare numbers or "high energy" prose must never parse.
 */
export function energyFromComments(comments: string | null): number | null {
  if (comments === null) return null
  const match = /\benergy\s*[:-]?\s*(10|[1-9])\b/i.exec(comments)
  return match === null ? null : Number(match[1])
}

/**
 * The import report deliberately counts only the five wheel/combo axes —
 * a library without remixers or labels is not "missing metadata".
 */
export type MetadataField = 'key' | 'bpm' | 'genre' | 'year' | 'rating'

export const METADATA_FIELDS: readonly MetadataField[] = ['key', 'bpm', 'genre', 'year', 'rating']

export interface ImportReport {
  total: number
  missing: Record<MetadataField, number>
  errors: string[]
  /** Informational messages (not failures), e.g. playlist rematch results. */
  notes?: string[]
}

/**
 * A user-marked "these mix well" pair (v12 WS9): a forward-looking planning
 * annotation, never a record of performed transitions. Unordered; `tag` is a
 * free short note ("mashup", "tested").
 */
export interface ManualEdge {
  a: string
  b: string
  tag?: string
}

/** A named playlist from the source library: track ids in playlist order. */
export interface Playlist {
  name: string
  trackIds: string[]
}

export interface ImportResult {
  tracks: Track[]
  report: ImportReport
  /** Playlists found in the source (Rekordbox XML); absent elsewhere. */
  playlists?: Playlist[]
}

export function buildReport(tracks: Track[], errors: string[]): ImportReport {
  const missing = { key: 0, bpm: 0, genre: 0, year: 0, rating: 0 }
  for (const track of tracks) {
    for (const field of METADATA_FIELDS) {
      if (track[field] === null) missing[field]++
    }
  }
  return { total: tracks.length, missing, errors }
}
