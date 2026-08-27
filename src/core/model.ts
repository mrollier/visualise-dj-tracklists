import { normalizeKey, type CamelotKey } from './keys'

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
   * Model-derived descriptors as whole percentages 0–100 (v35). Rekordbox
   * never supplies these — they arrive only from the analysis sidecar, so a
   * null means the track has no analysis entry. `arousal` and `valence` are
   * the emoMusic head's 1–9 rescaled; `danceability` and `happiness` are the
   * matching heads' probabilities. See `percentFromAffect` in analysis.ts.
   */
  arousal: number | null
  valence: number | null
  danceability: number | null
  happiness: number | null
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
  arousal: null,
  valence: null,
  danceability: null,
  happiness: null,
  playCount: null,
  remixer: null,
  label: null,
  mix: null,
  colour: null,
  dateModified: null,
  lastPlayed: null,
}

/** Where a track's key/BPM ground truth comes from (v36). */
export type MetadataSource = 'rekordbox' | 'comments'

/** The MIK tokens found in a Comments field; null per slot when absent. */
export interface MikComment {
  key: CamelotKey | null
  bpm: number | null
  energy: number | null
}

const WORDED_ENERGY_RE = /\benergy\s*[:-]?\s*(10|[1-9])\b/i
// Camelot only, by shape: digit-leading can never reach normalizeKey's
// classical branch, so prose like "d-floor" never reads as a key.
// ponytail: sharps/flats comment notation unsupported until a MIK config uses it.
const COMMENT_KEY_SHAPE_RE = /^\d{1,2}\s*[ab]$/i
const BARE_ENERGY_RE = /^(10|[1-9])$/
const TEMPO_RE = /^\d{1,3}(\.\d+)?$/

/**
 * Parse the Mixed In Key tokens out of a Comments field (v36). MIK writes
 * hyphen-delimited segments in any of its eight configured formats — key,
 * tempo and energy in either order, energy worded ("Energy 7") or bare ("7").
 * The worded form is also accepted embedded in prose (the v12 behaviour);
 * bare tokens must be whole segments, so "Track 7 - remix" yields nothing.
 */
export function parseMikComment(comments: string | null): MikComment {
  const result: MikComment = { key: null, bpm: null, energy: null }
  if (comments === null) return result

  const worded = WORDED_ENERGY_RE.exec(comments)
  if (worded !== null) result.energy = Number(worded[1])

  for (const raw of comments.split(/\s+-\s+/)) {
    const segment = raw.trim()
    if (result.key === null && COMMENT_KEY_SHAPE_RE.test(segment)) {
      result.key = normalizeKey(segment)
    } else if (result.energy === null && BARE_ENERGY_RE.test(segment)) {
      result.energy = Number(segment)
    } else if (result.bpm === null && TEMPO_RE.test(segment)) {
      const bpm = Number(segment)
      // ponytail: 40–250 eyeballed as the playable-tempo band; widen if a
      // real library ever carries something outside it.
      if (bpm >= 40 && bpm <= 250) result.bpm = bpm
    }
  }
  return result
}

/**
 * Mixed-In-Key-style energy from a Comments field (v12 WS8, widened v36 to
 * MIK's bare-number formats: "7", "10A - 7", "10A - 126 - 7").
 */
export function energyFromComments(comments: string | null): number | null {
  return parseMikComment(comments).energy
}

/**
 * Substitute comment-sourced key/BPM per the v36 source preference. A
 * comment-derived value wins when present; a track whose comment has no
 * parsable token keeps its Rekordbox value — flipping the setting never
 * blanks metadata. Returns the input array by reference when nothing
 * changes, so downstream memos stay inert (the mergeAnalysis idiom).
 */
export function applySourcePreference(
  tracks: Track[],
  prefs: { keySource: MetadataSource; bpmSource: MetadataSource },
): Track[] {
  if (prefs.keySource === 'rekordbox' && prefs.bpmSource === 'rekordbox') return tracks
  let changed = false
  const out = tracks.map((t) => {
    const parsed = parseMikComment(t.comments)
    const key = prefs.keySource === 'comments' ? (parsed.key ?? t.key) : t.key
    const bpm = prefs.bpmSource === 'comments' ? (parsed.bpm ?? t.bpm) : t.bpm
    if (key === t.key && bpm === t.bpm) return t
    changed = true
    return { ...t, key, bpm }
  })
  return changed ? out : tracks
}

/**
 * The import report deliberately counts only the five wheel/combo axes —
 * a library without remixers or labels is not "missing metadata".
 */
type MetadataField = 'key' | 'bpm' | 'genre' | 'year' | 'rating'

const METADATA_FIELDS: readonly MetadataField[] = ['key', 'bpm', 'genre', 'year', 'rating']

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
